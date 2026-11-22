/**
 * Encrypted storage for the Home snapshot. Sealed with the sync mirror's key
 * (the keystore-held DEK), bound to the per-account storage key, so it is as
 * protected as the mirror and unreadable once sign-out destroys that key.
 */

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { decryptWith, encryptWith, loadKey } from '@/sync/rowCipher';

import { parseSnapshot, serialiseSnapshot, snapshotKey, type HomeSnapshot } from './homeSnapshot';

const memory = new Map<string, HomeSnapshot | null>();
// Per owner: loads, saves and the wipe run one at a time, and the wipe bumps the
// generation so anything started before it can no longer write back afterwards.
const generation = new Map<string, number>();
const chain = new Map<string, Promise<unknown>>();
const gen = (owner: string): number => generation.get(owner) ?? 0;

function serialised<T>(owner: string, task: () => Promise<T>): Promise<T> {
  const run = (chain.get(owner) ?? Promise.resolve()).then(task, task);
  chain.set(
    owner,
    run.catch(() => {}),
  );
  return run;
}

export function loadHomeSnapshot(viewerId: string): Promise<HomeSnapshot | null> {
  const started = gen(viewerId);
  return serialised(viewerId, async () => {
    if (started !== gen(viewerId)) return null;
    if (memory.has(viewerId)) return memory.get(viewerId) ?? null;
    const storageKey = snapshotKey(viewerId);
    try {
      const [stored, key] = await Promise.all([AsyncStorage.getItem(storageKey), loadKey()]);
      const snapshot = stored
        ? parseSnapshot(decryptWith(key, stored, storageKey), viewerId)
        : null;
      if (started !== gen(viewerId)) return null;
      memory.set(viewerId, snapshot);
      return snapshot;
    } catch {
      return null;
    }
  });
}

export function saveHomeSnapshot(snapshot: HomeSnapshot): Promise<void> {
  const owner = snapshot.viewerId;
  const started = gen(owner);
  return serialised(owner, async () => {
    if (started !== gen(owner)) return;
    const storageKey = snapshotKey(owner);
    try {
      const key = await loadKey();
      if (started !== gen(owner)) return;
      memory.set(owner, snapshot);
      await AsyncStorage.setItem(
        storageKey,
        encryptWith(key, serialiseSnapshot(snapshot), storageKey),
      );
    } catch {
      // A missed save only costs the next launch its instant frame.
    }
  });
}

export async function clearHomeSnapshot(ownerId: string): Promise<void> {
  generation.set(ownerId, gen(ownerId) + 1);
  memory.delete(ownerId);
  await serialised(ownerId, () => AsyncStorage.removeItem(snapshotKey(ownerId)));
}

/** The stored frame for this account, once read; null while reading or if none. */
export function useHomeSnapshot(viewerId: string | null): HomeSnapshot | null {
  const [read, setRead] = useState<HomeSnapshot | null>(null);
  useEffect(() => {
    if (!viewerId) return;
    let stale = false;
    void loadHomeSnapshot(viewerId).then((s) => !stale && setRead(s));
    return () => {
      stale = true;
    };
  }, [viewerId]);
  // Tagged with its owner, so an account swap can never show the old frame.
  return viewerId && read?.viewerId === viewerId ? read : null;
}
