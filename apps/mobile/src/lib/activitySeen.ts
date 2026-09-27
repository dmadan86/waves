/**
 * When the reader last looked at the Activity feed — the other half of the red
 * dot on the dashboard's bell. The dot shows while somebody else has done
 * something since then (`useNewestActivityFromOthers`), and opening Activity
 * clears it.
 *
 * Module-scoped with listeners rather than React state, so the Activity screen
 * marking the feed seen moves the dashboard's bell straight away, and stored so
 * a relaunch does not light the dot for things already read. Until the stored
 * value has loaded the answer is "unknown", and unknown never shows a dot — a
 * dot that flashes on and off at every launch would be worse than none.
 */

import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'activity:lastSeenAt';

/** ms of the last look; `null` until the stored value has been read. */
let seenAt: number | null = null;
const listeners = new Set<() => void>();

function commit(next: number): void {
  if (next === seenAt) return;
  seenAt = next;
  for (const listener of listeners) listener();
}

let loading: Promise<void> | null = null;
function load(): void {
  if (loading) return;
  loading = AsyncStorage.getItem(KEY)
    .then((value) => {
      // A mark made while the read was in flight is newer than what was stored.
      if (seenAt === null) commit(Number(value) || 0);
    })
    .catch(() => {
      if (seenAt === null) commit(0);
    });
}

function subscribe(listener: () => void): () => void {
  load();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): number | null {
  return seenAt;
}

/** When the feed was last looked at, in ms; `null` while that is not yet known. */
export function useActivitySeenAt(): number | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * The feed has been looked at, up to `at` (ms). Never moves backwards: a later
 * mark with an older time — a device clock set back — does not re-light what
 * was already read.
 */
export function markActivitySeen(at: number): void {
  const next = Math.max(at, seenAt ?? 0);
  commit(next);
  void AsyncStorage.setItem(KEY, String(next)).catch(() => {});
}

/** Whether the bell wears its dot: news since the last look, and the last look known. */
export function hasUnseenActivity(newestFromOthers: number, lastSeen: number | null): boolean {
  return lastSeen !== null && newestFromOthers > lastSeen;
}

/** Test seam: forget the loaded value. */
export function resetActivitySeenForTests(): void {
  seenAt = null;
  loading = null;
  listeners.clear();
}
