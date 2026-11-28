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

import {
  loadDeviceKey,
  registerDevice,
  registeredDeviceId,
  forgetDeviceId,
  readInstallDevice,
  writeInstallDevice,
} from './deviceKey';
import { coupleBridge } from '@/lib/backup/coupleBridge';
import type { BackupCouple } from '@/lib/backup/payload';

import type { Meta } from './deviceNotice';
import { createMailbox } from './mailbox';
import { E2eeSpace, type GroupRecord } from './space';
import { canAdoptLegacyOwner, ownerMismatch, SessionGeneration } from './session';

export const e2eeSpace = new E2eeSpace(
  syncEngine.localStore,
  {
    now: () => Date.now(),
    newId: () => Crypto.randomUUID(),
  },
  () => activeProfileId,
);
syncEngine.beforeE2eeWipe = drainE2ee;

const registering = new Map<string, Promise<string>>();
let activeProfileId: string | null = null;
let hydratedOwnerId: string | null = null;
const hydrationListeners = new Set<() => void>();
const notifyHydration = () => hydrationListeners.forEach((listener) => listener());
const generations = new SessionGeneration();
const OWNER_KEY = 'waves.e2ee.owner';
const LAST_PROFILE_KEY = 'waves.auth.last-profile-id';
let pendingMetaCleanup: Promise<void> = Promise.resolve();

/** Capture the active E2EE account generation for work that crosses awaits. */
export function captureE2eeOwner(ownerId: string): () => boolean {
  const generation = generations.snapshot();
  return () => ownerId === activeProfileId && generations.matches(generation);
}

/** An empty device lookup only means "revoked" if the request was signed in. */
async function requireSession(): Promise<void> {
  const { data } = await backend.auth.getSession();
  if (!data.session) throw new Error('E2EE session not ready');
}

/** This phone's device id on the server, registering it first if need be. */
export async function ensureDeviceId(profileId = activeProfileId): Promise<string> {
  if (!profileId) return Promise.reject(new Error('E2EE requires a verified profile id'));
  const isCurrent = activeProfileId === profileId ? isSessionCurrent : () => false;
  const current = () => activeProfileId === profileId && isCurrent();
  const revokedKey = `waves.e2ee.revoked.${encodeURIComponent(profileId)}`;
  if (await AsyncStorage.getItem(revokedKey)) {
    if (!current()) throw new Error('E2EE session changed');
    throw new Error('E2EE device was revoked');
  }
  const storedDeviceId = await AsyncStorage.getItem(
    `waves.e2ee.device-id.${encodeURIComponent(profileId)}`,
  );
  if (!current())
    return activeProfileId
      ? ensureDeviceId(activeProfileId)
      : Promise.reject(new Error('E2EE session changed'));
  if (!current()) throw new Error('E2EE session changed');
  if (
    storedDeviceId &&
    (await AsyncStorage.getItem(`${META_PREFIX}device-revoked:${storedDeviceId}`)) === '1'
  )
    throw new Error('E2EE device was revoked');
  if (storedDeviceId) {
    if (!current())
      return activeProfileId
        ? ensureDeviceId(activeProfileId)
        : Promise.reject(new Error('E2EE session changed'));
    const { data, error } = await backend
      .from('e2ee_devices')
      .select('id')
      .eq('id', storedDeviceId)
      .maybeSingle();
    if (!current())
      return activeProfileId
        ? ensureDeviceId(activeProfileId)
        : Promise.reject(new Error('E2EE session changed'));
    if (error) throw error;
    if (data === null) {
      // No row can also mean the request went out without a session (refreshing after offline).
      await requireSession();
      // A profile switch during the directory request must not record this
      // account's revocation against a different active session.
      if (!current()) throw new Error('E2EE session changed');
      await markDeviceRevoked(profileId, current);
      if (!current()) throw new Error('E2EE session changed');
      await AsyncStorage.setItem(`${META_PREFIX}device-revoked:${storedDeviceId}`, '1');
      throw new Error('E2EE device was revoked');
    }
  }
  const known = registeredDeviceId(profileId);
  if (known) return known;
  let pending = registering.get(profileId);
  if (!pending) {
    pending = registerDevice(profileId, async (publicKey) => {
      if (!current()) throw new Error('E2EE session changed');
      const { data, error } = await backend.rpc('waves_register_device', {
        p_public_key: publicKey,
      });
      if (!current()) throw new Error('E2EE session changed');
      if (error) throw error;
      return data as string;
    }).finally(() => {
      registering.delete(profileId);
    });
    registering.set(profileId, pending);
  }
  const id = await pending;
  if (!current()) throw new Error('E2EE session changed');
  // The same install now has a new device id: tell the server the old one is replaced.
  const previous = storedDeviceId ?? (await readInstallDevice(profileId));
  if (previous && previous !== id) {
    await backend
      .rpc('waves_replace_device', { p_old: previous, p_new: id })
      .then(undefined, () => undefined); // best effort: the 30-day rule still applies
  }
  await writeInstallDevice(profileId, id);
  if (!current()) throw new Error('E2EE session changed');
  await AsyncStorage.setItem(`waves.e2ee.device-id.${encodeURIComponent(profileId)}`, id);
  if (!current()) throw new Error('E2EE session changed');
  if ((await AsyncStorage.getItem(`${META_PREFIX}device-revoked:${id}`)) === '1') {
    await markDeviceRevoked(profileId, current);
    throw new Error('E2EE device was revoked');
  }
  return id;
}

/** Record a server-side device revocation so background restart cannot re-enrol it. */
export async function markDeviceRevoked(
  profileId: string,
  isCurrent: () => boolean = () => activeProfileId === profileId,
): Promise<void> {
  if (!isCurrent()) throw new Error('E2EE session changed');
  await AsyncStorage.setItem(`waves.e2ee.revoked.${encodeURIComponent(profileId)}`, '1');
  if (!isCurrent()) throw new Error('E2EE session changed');
  forgetDeviceId(profileId);
}

/** Explicit recovery action for a device whose server registration was revoked. */
export async function clearDeviceRevoked(profileId: string): Promise<void> {
  await AsyncStorage.removeItem(`waves.e2ee.revoked.${encodeURIComponent(profileId)}`);
  const id = await AsyncStorage.getItem(`waves.e2ee.device-id.${encodeURIComponent(profileId)}`);
  if (id) {
    await AsyncStorage.removeItem(`${META_PREFIX}device-revoked:${id}`);
    await AsyncStorage.removeItem(`waves.e2ee.device-id.${encodeURIComponent(profileId)}`);
  }
  forgetDeviceId(profileId);
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
  groupName,
  meta,
  space: e2eeSpace,
  outbox: syncEngine.localStore,
  keys: { pair: () => loadDeviceKey(activeProfileId ?? ''), deviceId: () => ensureDeviceId() },
  deviceStatus: async (deviceId) => {
    const owner = activeProfileId;
    const generation = generations.snapshot();
    const current = () =>
      owner !== null && owner === activeProfileId && generations.matches(generation);
    const { data, error } = await backend
      .from('e2ee_devices')
      .select('id')
      .eq('id', deviceId)
      .maybeSingle();
    if (!current()) throw new Error('E2EE session changed');
    if (error) throw error;
    if (data === null) await requireSession(); // never mark revoked on an anonymous read
    return data !== null;
  },
  isCurrent: () => activeProfileId !== null && isSessionCurrent(),
  captureCurrent: () => {
    const owner = activeProfileId;
    const generation = generations.snapshot();
    return () => owner !== null && owner === activeProfileId && generations.matches(generation);
  },
  owner: () => activeProfileId,
  randomBytes: (n) => Crypto.getRandomBytes(n),
  now: () => Date.now(),
  report: reportHandled,
});

// A local write is sent at once; a failure stays in the outbox for the next round.
e2eeSpace.onOutbox = () => void withE2eeLock(() => mailbox.flushOutbox()).catch(() => undefined);

let running: Promise<number> | null = null;
let isSessionCurrent = (): boolean => false;
let queue: Promise<void> = Promise.resolve();

function withE2eeLock<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * Pick up mail and send what is waiting. Safe to call from anywhere, any number of
 * times: one round runs at a time, and a failure (offline) is retried by the next call.
 */
/** Resolves to how many incoming changes were applied (0 on failure). */
export function syncE2ee(): Promise<number> {
  running ??= withE2eeLock(() => mailbox.sync())
    .catch(() => 0)
    .finally(() => {
      running = null;
    });
  return running;
}

/** Whether this account has a couple/home space worth polling for. */
export const hasCoupleSpace = (): boolean =>
  activeProfileId !== null && coupleGroupIds().length > 0;

/** Groups whose queued mailbox messages were quarantined after permanent membership loss. */
export function getE2eeOutboxFailures(): Promise<{ groupId: string; reason: string }[]> {
  return mailbox.failedOutboxGroups();
}

/** Sign-in: load what is on the phone, make sure the server knows this device, then sync. */
export function startE2ee(profileId: string): Promise<void> {
  generations.invalidate();
  const generation = generations.snapshot();
  isSessionCurrent = () => false;
  if (activeProfileId !== profileId) activeProfileId = null;
  return withE2eeLock(async () => {
    if (!generations.matches(generation)) return;
    await startE2eeLocked(profileId, generation);
  });
}

async function startE2eeLocked(profileId: string, generation: number): Promise<void> {
  const isCurrent = () => generations.matches(generation);
  isSessionCurrent = isCurrent;
  activeProfileId = profileId;
  hydratedOwnerId = null;
  notifyHydration();
  await pendingMetaCleanup;
  if (!isCurrent()) return;
  const storedOwner = await AsyncStorage.getItem(OWNER_KEY);
  if (ownerMismatch(storedOwner, profileId)) {
    if (!isCurrent()) return;
    await syncEngine.localStore.wipeE2ee();
    if (!isCurrent()) return;
    const keys = await AsyncStorage.getAllKeys();
    if (!isCurrent()) return;
    await AsyncStorage.removeMany([...keys.filter((k) => k.startsWith(META_PREFIX)), OWNER_KEY]);
    if (!isCurrent()) return;
    await AsyncStorage.setItem(OWNER_KEY, profileId);
  } else if (storedOwner === null) {
    if (!isCurrent()) return;
    const [lastProfile, legacyRecords] = await Promise.all([
      AsyncStorage.getItem(LAST_PROFILE_KEY),
      syncEngine.localStore.readE2eeRecords(),
    ]);
    if (!isCurrent()) return;
    if (legacyRecords.length > 0 && !canAdoptLegacyOwner(lastProfile, profileId)) {
      await syncEngine.localStore.wipeE2ee();
      if (!isCurrent()) return;
      const keys = await AsyncStorage.getAllKeys();
      if (!isCurrent()) return;
      await AsyncStorage.removeMany(keys.filter((k) => k.startsWith(META_PREFIX)));
      if (!isCurrent()) return;
    }
    await AsyncStorage.setItem(OWNER_KEY, profileId);
  }
  if (!isCurrent()) return;
  await e2eeSpace.load(isCurrent);
  if (!isCurrent()) return;
  hydratedOwnerId = profileId;
  await AsyncStorage.setItem(LAST_PROFILE_KEY, profileId);
  if (!isCurrent()) return;
  notifyHydration();
  await mailbox.notices.load();
  if (!isCurrent()) return;
  forgetDeviceId(profileId);
  mailbox.forgetDevices();
  await ensureDeviceId(profileId).catch(() => undefined);
  if (!isCurrent()) return;
  await mailbox.sync();
}

/** Sign-out: drop what is in memory (the engine wipes the tables). */
export function stopE2ee(): void {
  generations.invalidate();
  isSessionCurrent = () => false;
  activeProfileId = null;
  hydratedOwnerId = null;
  e2eeSpace.clear();
  void withE2eeLock(async () => stopE2eeLocked());
}

function stopE2eeLocked(): void {
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
export async function restoreCoupleFromBackup(
  entries: readonly BackupCouple[],
  isCurrent: () => boolean = () => true,
): Promise<void> {
  if (!isCurrent()) return;
  const live = coupleGroupIds();
  await e2eeSpace.restoreCouple(entries, live, isCurrent);
  if (!isCurrent()) return;
  for (const g of live) {
    if (!isCurrent()) return;
    await mailbox.requestResync(g).catch(() => undefined);
  }
}

coupleBridge.backup = coupleBackup;
coupleBridge.restore = restoreCoupleFromBackup;
coupleBridge.captureOwner = captureE2eeOwner;

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
