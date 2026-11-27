/**
 * The couple space, wired to this phone: the one store, the Supabase client and the
 * device key. Screens read it through the hooks; `sync/provider` starts and stops it.
 */

import { useMemo, useSyncExternalStore } from 'react';
import * as Crypto from 'expo-crypto';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { SyncTable } from '@waves/core';

import { reportHandled } from '@/lib/observability';
import { backend } from '@/lib/backend';
import { syncEngine } from '@/sync/engine';

import { loadDeviceKey, registerDevice, registeredDeviceId, forgetDeviceId } from './deviceKey';
import { coupleBridge } from '@/lib/backup/coupleBridge';
import type { BackupCouple } from '@/lib/backup/payload';

import type { Meta } from './deviceNotice';
import { createMailbox } from './mailbox';
import { E2eeSpace, type GroupRecord } from './space';
import { ownerMismatch, SessionGeneration } from './session';

export const e2eeSpace = new E2eeSpace(syncEngine.localStore, {
  now: () => Date.now(),
  newId: () => Crypto.randomUUID(),
});
syncEngine.beforeE2eeWipe = drainE2ee;

const registering = new Map<string, Promise<string>>();
let activeProfileId: string | null = null;
let hydratedOwnerId: string | null = null;
const hydrationListeners = new Set<() => void>();
const notifyHydration = () => hydrationListeners.forEach((listener) => listener());
const generations = new SessionGeneration();
const OWNER_KEY = 'waves.e2ee.owner';
let pendingMetaCleanup: Promise<void> = Promise.resolve();

/** This phone's device id on the server, registering it first if need be. */
export async function ensureDeviceId(profileId = activeProfileId): Promise<string> {
  if (!profileId) return Promise.reject(new Error('E2EE requires a verified profile id'));
  const revokedKey = `waves.e2ee.revoked.${encodeURIComponent(profileId)}`;
  if (await AsyncStorage.getItem(revokedKey)) throw new Error('E2EE device was revoked');
  const storedDeviceId = await AsyncStorage.getItem(
    `waves.e2ee.device-id.${encodeURIComponent(profileId)}`,
  );
  if (
    storedDeviceId &&
    (await AsyncStorage.getItem(`${META_PREFIX}device-revoked:${storedDeviceId}`)) === '1'
  )
    throw new Error('E2EE device was revoked');
  if (storedDeviceId) {
    const { data, error } = await backend
      .from('e2ee_devices')
      .select('id')
      .eq('id', storedDeviceId)
      .maybeSingle();
    if (error) throw error;
    if (data === null) {
      await markDeviceRevoked(profileId);
      await AsyncStorage.setItem(`${META_PREFIX}device-revoked:${storedDeviceId}`, '1');
      throw new Error('E2EE device was revoked');
    }
  }
  const known = registeredDeviceId(profileId);
  if (known) return known;
  let pending = registering.get(profileId);
  if (!pending) {
    pending = registerDevice(profileId, async (publicKey) => {
      const { data, error } = await backend.rpc('waves_register_device', {
        p_public_key: publicKey,
      });
      if (error) throw error;
      return data as string;
    }).finally(() => {
      registering.delete(profileId);
    });
    registering.set(profileId, pending);
  }
  const id = await pending;
  await AsyncStorage.setItem(`waves.e2ee.device-id.${encodeURIComponent(profileId)}`, id);
  if ((await AsyncStorage.getItem(`${META_PREFIX}device-revoked:${id}`)) === '1') {
    await markDeviceRevoked(profileId);
    throw new Error('E2EE device was revoked');
  }
  return id;
}

/** Record a server-side device revocation so background restart cannot re-enrol it. */
export async function markDeviceRevoked(profileId: string): Promise<void> {
  await AsyncStorage.setItem(`waves.e2ee.revoked.${encodeURIComponent(profileId)}`, '1');
  forgetDeviceId(profileId);
}

/** Explicit recovery action for a device whose server registration was revoked. */
export async function clearDeviceRevoked(profileId: string): Promise<void> {
  await AsyncStorage.removeItem(`waves.e2ee.revoked.${encodeURIComponent(profileId)}`);
  const id = await AsyncStorage.getItem(`waves.e2ee.device-id.${encodeURIComponent(profileId)}`);
  if (id) await AsyncStorage.removeItem(`${META_PREFIX}device-revoked:${id}`);
}

const META_PREFIX = 'waves.e2ee.meta.';
const meta: Meta = {
  get: (key) => AsyncStorage.getItem(META_PREFIX + key),
  set: (key, value) => AsyncStorage.setItem(META_PREFIX + key, value),
};

interface GroupRow {
  name?: unknown;
  type?: unknown;
  archived_at?: unknown;
}

function myGroups(): Record<string, GroupRow> {
  return (syncEngine.getState().mirror.tables[SyncTable.Groups] ?? {}) as Record<string, GroupRow>;
}

/** The couple/home groups this account is in right now. */
const coupleGroupIds = (): string[] =>
  Object.entries(myGroups())
    .filter(([, g]) => (g.type === 'couple' || g.type === 'home') && !g.archived_at)
    .map(([id]) => id);

const groupName = (id: string): string => String(myGroups()[id]?.name ?? '');

// A group that leaves the mirror (left, removed, deleted): keep a read-only copy on this phone only.
syncEngine.beforeGroupDropped = (groupId, name) => e2eeSpace.retire(groupId, name);

const mailbox = createMailbox({
  client: backend as never,
  groups: coupleGroupIds,
  meta,
  space: e2eeSpace,
  outbox: syncEngine.localStore,
  keys: { pair: () => loadDeviceKey(activeProfileId ?? ''), deviceId: () => ensureDeviceId() },
  deviceStatus: async (deviceId) => {
    const { data, error } = await backend
      .from('e2ee_devices')
      .select('id')
      .eq('id', deviceId)
      .maybeSingle();
    if (error) throw error;
    return data !== null;
  },
  isCurrent: () => activeProfileId !== null && isSessionCurrent(),
  captureCurrent: () => {
    const owner = activeProfileId;
    const generation = generations.snapshot();
    return () => owner !== null && owner === activeProfileId && generations.matches(generation);
  },
  randomBytes: (n) => Crypto.getRandomBytes(n),
  now: () => Date.now(),
  report: reportHandled,
});

// A local write is sent at once; a failure stays in the outbox for the next round.
e2eeSpace.onOutbox = () => void mailbox.flushOutbox().catch(() => undefined);

let running: Promise<void> | null = null;
let isSessionCurrent = (): boolean => false;

/**
 * Pick up mail and send what is waiting. Safe to call from anywhere, any number of
 * times: one round runs at a time, and a failure (offline) is retried by the next call.
 */
export function syncE2ee(): Promise<void> {
  running ??= mailbox
    .sync()
    .catch(() => undefined)
    .finally(() => {
      running = null;
    });
  return running;
}

/** Groups whose queued mailbox messages were quarantined after permanent membership loss. */
export function getE2eeOutboxFailures(): Promise<{ groupId: string; reason: string }[]> {
  return mailbox.failedOutboxGroups();
}

/** Sign-in: load what is on the phone, make sure the server knows this device, then sync. */
export async function startE2ee(profileId: string): Promise<void> {
  await pendingMetaCleanup;
  const isCurrent = generations.bump();
  isSessionCurrent = isCurrent;
  activeProfileId = profileId;
  hydratedOwnerId = null;
  notifyHydration();
  const storedOwner = await AsyncStorage.getItem(OWNER_KEY);
  if (ownerMismatch(storedOwner, profileId)) {
    await syncEngine.localStore.wipeE2ee();
    const keys = await AsyncStorage.getAllKeys();
    await AsyncStorage.removeMany([...keys.filter((k) => k.startsWith(META_PREFIX)), OWNER_KEY]);
    if (!isCurrent()) return;
    await AsyncStorage.setItem(OWNER_KEY, profileId);
  } else if (storedOwner === null) {
    if (!isCurrent()) return;
    await AsyncStorage.setItem(OWNER_KEY, profileId);
  }
  if (!isCurrent()) return;
  await e2eeSpace.load(isCurrent);
  if (!isCurrent()) return;
  hydratedOwnerId = profileId;
  notifyHydration();
  await mailbox.notices.load();
  if (!isCurrent()) return;
  forgetDeviceId(profileId);
  mailbox.forgetDevices();
  await ensureDeviceId(profileId).catch(() => undefined);
  if (!isCurrent()) return;
  await syncE2ee();
}

/** Sign-out: drop what is in memory (the engine wipes the tables). */
export function stopE2ee(): void {
  generations.invalidate();
  activeProfileId = null;
  hydratedOwnerId = null;
  notifyHydration();
  e2eeSpace.clear();
  mailbox.notices.clear();
  // Last fetch, known devices and notices belong to the account that just left.
  pendingMetaCleanup = AsyncStorage.getAllKeys()
    .then((keys) =>
      AsyncStorage.removeMany(
        keys.filter((k) => k.startsWith(META_PREFIX) && !k.includes('device-revoked:')),
      ),
    )
    .catch(() => undefined);
  forgetDeviceId();
  mailbox.forgetDevices();
}

/** Stop and drain current mailbox work before the account's E2EE tables are wiped. */
export async function drainE2ee(): Promise<void> {
  generations.invalidate();
  activeProfileId = null;
  const inFlight = running;
  if (inFlight) await inFlight;
  await e2eeSpace.drain();
}

export function useE2eeReady(profileId: string): boolean {
  const ready = useSyncExternalStore(
    (listener) => {
      hydrationListeners.add(listener);
      return () => hydrationListeners.delete(listener);
    },
    () => hydratedOwnerId === profileId,
    () => false,
  );
  return ready;
}

/** This phone's clock id for stamping edits (see `deviceKey.clockId`). */
export { clockId } from './deviceKey';

const NONE: readonly GroupRecord[] = [];

/** One couple group's records, live. */
export function useE2eeRecords(groupId?: string): readonly GroupRecord[] {
  const version = useSyncExternalStore(
    e2eeSpace.subscribe,
    () => e2eeSpace.version,
    () => 0,
  );
  return useMemo(
    () => (groupId ? e2eeSpace.records(groupId) : NONE),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groupId, version],
  );
}

/** Every record of every group this phone holds, for the document sweep. */
export function useAllE2eeRecords(): readonly GroupRecord[] {
  const version = useSyncExternalStore(
    e2eeSpace.subscribe,
    () => e2eeSpace.version,
    () => 0,
  );
  return useMemo(
    () => e2eeSpace.groupIds().flatMap((g) => e2eeSpace.records(g)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );
}

/** Shared rentals for a backup, one entry per couple group this phone holds. */
export const coupleBackup = (): BackupCouple[] => e2eeSpace.backupCouple(groupName);

/** Put a backup's shared rentals back (tables only), then ask the partner's phone for the gap. */
export async function restoreCoupleFromBackup(entries: readonly BackupCouple[]): Promise<void> {
  const live = coupleGroupIds();
  await e2eeSpace.restoreCouple(entries, live);
  for (const g of live) await mailbox.requestResync(g).catch(() => undefined);
}

coupleBridge.backup = coupleBackup;
coupleBridge.restore = restoreCoupleFromBackup;

/** Live shared rentals on this phone, for the sign-out prompt. */
export const coupleRecordCount = (): number =>
  e2eeSpace.liveGroupIds().reduce((n, g) => n + e2eeSpace.records(g).length, 0);
coupleBridge.count = coupleRecordCount;
coupleBridge.formerCount = () => e2eeSpace.formerGroups().length;
coupleBridge.risk = async () => {
  const records = e2eeSpace.groupIds().flatMap((groupId) => e2eeSpace.snapshot(groupId));
  const walls = records
    .flatMap((record) => [
      ...Object.values(record.fields).map(([, hlc]) => Number(hlc.split(':', 1)[0])),
      ...(record.deleted ? [Number(record.deleted.split(':', 1)[0])] : []),
    ])
    .filter(Number.isFinite);
  return {
    outboxCount: (await syncEngine.localStore.readE2eeOutbox()).length,
    lastLocalChangeAt: walls.length ? Math.max(...walls) : null,
  };
};

function useSpaceVersion(): number {
  return useSyncExternalStore(
    e2eeSpace.subscribe,
    () => e2eeSpace.version,
    () => 0,
  );
}

/** Couples this phone has left: read-only copies, never sent anywhere. */
export function useFormerCouples(): { groupId: string; name: string }[] {
  const version = useSpaceVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => e2eeSpace.formerGroups(), [version]);
}

/** "<Name> added a new phone." notices for one couple group. */
export function useNewPhoneNotices(groupId?: string) {
  const version = useSyncExternalStore(
    mailbox.notices.subscribe,
    () => mailbox.notices.version,
    () => 0,
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (groupId ? mailbox.notices.list(groupId) : []), [groupId, version]);
}

export const dismissPhoneNotice = (deviceId: string): Promise<void> =>
  mailbox.notices.dismiss(deviceId);
