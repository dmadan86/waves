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

export const e2eeSpace = new E2eeSpace(syncEngine.localStore, {
  now: () => Date.now(),
  newId: () => Crypto.randomUUID(),
});

let registering: Promise<string> | null = null;

/** This phone's device id on the server, registering it first if need be. */
export function ensureDeviceId(): Promise<string> {
  const known = registeredDeviceId();
  if (known) return Promise.resolve(known);
  registering ??= registerDevice(async (publicKey) => {
    const { data, error } = await backend.rpc('waves_register_device', {
      p_public_key: publicKey,
    });
    if (error) throw error;
    return data as string;
  }).finally(() => {
    registering = null;
  });
  return registering;
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
  keys: { pair: loadDeviceKey, deviceId: ensureDeviceId },
  randomBytes: (n) => Crypto.getRandomBytes(n),
  now: () => Date.now(),
  report: reportHandled,
});

// A local write is sent at once; a failure stays in the outbox for the next round.
e2eeSpace.onOutbox = () => void mailbox.flushOutbox().catch(() => undefined);

let running: Promise<void> | null = null;

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
export function getE2eeOutboxFailures(): Promise<string[]> {
  return mailbox.failedOutboxGroups();
}

/** Sign-in: load what is on the phone, make sure the server knows this device, then sync. */
export async function startE2ee(): Promise<void> {
  await e2eeSpace.load();
  await mailbox.notices.load();
  forgetDeviceId();
  mailbox.forgetDevices();
  await ensureDeviceId().catch(() => undefined);
  await syncE2ee();
}

/** Sign-out: drop what is in memory (the engine wipes the tables). */
export function stopE2ee(): void {
  e2eeSpace.clear();
  mailbox.notices.clear();
  // Last fetch, known devices and notices belong to the account that just left.
  void AsyncStorage.getAllKeys()
    .then((keys) => AsyncStorage.removeMany(keys.filter((k) => k.startsWith(META_PREFIX))))
    .catch(() => undefined);
  forgetDeviceId();
  mailbox.forgetDevices();
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
