/** "Not now" on a yearly rent increase, remembered on this device per tenancy and anniversary. */

import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'waves.rent.raise.skipped';
const EMPTY: ReadonlySet<string> = new Set();

let skipped: ReadonlySet<string> = EMPTY;
const listeners = new Set<() => void>();
let loaded = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(KEY)
    .then((raw) => {
      const keys: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(keys)) commit(new Set([...skipped, ...keys.map(String)]));
    })
    .catch(() => {});
}

function commit(next: ReadonlySet<string>): void {
  skipped = next;
  for (const l of listeners) l();
}

/** `key` is `RaisePrompt.key` (tenancy id + anniversary). */
export function skipRaise(key: string): void {
  const next = new Set(skipped).add(key);
  commit(next);
  void AsyncStorage.setItem(KEY, JSON.stringify([...next])).catch(() => {});
}

export function useRaiseSkips(): ReadonlySet<string> {
  load();
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => skipped,
    () => EMPTY,
  );
}
