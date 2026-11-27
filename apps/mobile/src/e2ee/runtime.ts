/**
 * The couple space, wired to this phone: the one store, the Supabase client and the
 * device key. Screens read it through the hooks; `sync/provider` starts and stops it.
 */

import { useMemo, useSyncExternalStore } from 'react';
import * as Crypto from 'expo-crypto';

import { reportHandled } from '@/lib/observability';
import { backend } from '@/lib/backend';
import { syncEngine } from '@/sync/engine';

import { loadDeviceKey, registerDevice, registeredDeviceId, forgetDeviceId } from './deviceKey';
import { createMailbox } from './mailbox';
import { E2eeSpace, type GroupRecord } from './space';

export const e2eeSpace = new E2eeSpace(syncEngine.localStore);

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

const mailbox = createMailbox({
  client: backend as never,
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

/** Sign-in: load what is on the phone, make sure the server knows this device, then sync. */
export async function startE2ee(): Promise<void> {
  await e2eeSpace.load();
  forgetDeviceId();
  mailbox.forgetDevices();
  await ensureDeviceId().catch(() => undefined);
  await syncE2ee();
}

/** Sign-out: drop what is in memory (the engine wipes the tables). */
export function stopE2ee(): void {
  e2eeSpace.clear();
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
