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

export async function loadHomeSnapshot(viewerId: string): Promise<HomeSnapshot | null> {
  if (memory.has(viewerId)) return memory.get(viewerId) ?? null;
  const storageKey = snapshotKey(viewerId);
  try {
    const [stored, key] = await Promise.all([AsyncStorage.getItem(storageKey), loadKey()]);
    const snapshot = stored ? parseSnapshot(decryptWith(key, stored, storageKey), viewerId) : null;
    memory.set(viewerId, snapshot);
    return snapshot;
  } catch {
    return null;
  }
}

export async function saveHomeSnapshot(snapshot: HomeSnapshot): Promise<void> {
  memory.set(snapshot.viewerId, snapshot);
  const storageKey = snapshotKey(snapshot.viewerId);
  try {
    const key = await loadKey();
    await AsyncStorage.setItem(
      storageKey,
      encryptWith(key, serialiseSnapshot(snapshot), storageKey),
    );
  } catch {
    // A missed save only costs the next launch its instant frame.
  }
}

export async function clearHomeSnapshot(ownerId: string): Promise<void> {
  memory.delete(ownerId);
  await AsyncStorage.removeItem(snapshotKey(ownerId));
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
