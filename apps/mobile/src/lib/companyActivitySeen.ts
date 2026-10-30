/**
 * When this phone last opened a company's activity feed — the other half of the bell's red dot.
 * Per company, stored on the device. Until the stored value has loaded the answer is "unknown" and
 * unknown never shows a dot; a company never opened here starts at "now", so its history does not
 * light the dot, only what happens after.
 */

import { useCallback, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const key = (groupId: string): string => `companyActivity:seenAt:${groupId}`;
const seen = new Map<string, number>();
const loading = new Set<string>();
const listeners = new Set<() => void>();

const commit = (groupId: string, at: number): void => {
  if (seen.get(groupId) === at) return;
  seen.set(groupId, at);
  for (const l of listeners) l();
};

function load(groupId: string): void {
  if (seen.has(groupId) || loading.has(groupId)) return;
  loading.add(groupId);
  AsyncStorage.getItem(key(groupId))
    .then((v) => {
      if (seen.has(groupId)) return;
      const at = Number(v) || Date.now();
      commit(groupId, at);
      if (!v) void AsyncStorage.setItem(key(groupId), String(at)).catch(() => {});
    })
    .catch(() => {
      if (!seen.has(groupId)) commit(groupId, Date.now());
    });
}

/** ms of the last look at this company's feed; `null` while not yet known. */
export function useCompanyActivitySeenAt(groupId: string): number | null {
  const subscribe = useCallback(
    (listener: () => void) => {
      load(groupId);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    [groupId],
  );
  const snapshot = useCallback(() => seen.get(groupId) ?? null, [groupId]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** The feed has been looked at up to `at`; never moves backwards. */
export function markCompanyActivitySeen(groupId: string, at: number): void {
  const next = Math.max(at, seen.get(groupId) ?? 0);
  commit(groupId, next);
  void AsyncStorage.setItem(key(groupId), String(next)).catch(() => {});
}
