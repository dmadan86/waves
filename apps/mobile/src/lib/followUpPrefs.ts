/**
 * Follow-up preferences (the on/off switch, muted question types, skip counts
 * and what was learned per category) live on this phone, one AsyncStorage entry
 * per signed-in account — the same pattern as the voice consent. The rules that
 * read them are in core (`followUps.ts`).
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_PREFS, parsePrefs, type FollowUpPrefs } from '@waves/core';

const keyFor = (viewerId: string): string => `waves.followup_prefs:${viewerId}`;

let current: { viewerId: string; prefs: FollowUpPrefs } | null = null;
const listeners = new Set<() => void>();
const loading = new Map<string, Promise<void>>();

function publish(viewerId: string, prefs: FollowUpPrefs): void {
  current = { viewerId, prefs };
  listeners.forEach((listener) => listener());
}

function load(viewerId: string): Promise<void> {
  if (current?.viewerId === viewerId) return Promise.resolve();
  const pending = loading.get(viewerId);
  if (pending) return pending;
  const next = (async () => {
    let prefs = DEFAULT_PREFS;
    try {
      prefs = parsePrefs(await AsyncStorage.getItem(keyFor(viewerId)));
    } catch {
      // Unreadable storage reads as the defaults.
    }
    if (current?.viewerId !== viewerId) publish(viewerId, prefs);
  })().finally(() => loading.delete(viewerId));
  loading.set(viewerId, next);
  return next;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export interface FollowUpPrefsHandle {
  /** False until the stored value has been read; nothing is asked meanwhile. */
  readonly ready: boolean;
  readonly prefs: FollowUpPrefs;
  /** Apply a change from the latest stored value and persist it. */
  readonly update: (change: (prefs: FollowUpPrefs) => FollowUpPrefs) => void;
}

export function useFollowUpPrefs(viewerId: string | null | undefined): FollowUpPrefsHandle {
  useEffect(() => {
    if (viewerId) void load(viewerId);
  }, [viewerId]);
  const snapshot = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  const ready = Boolean(viewerId) && snapshot?.viewerId === viewerId;
  const update = useCallback(
    (change: (prefs: FollowUpPrefs) => FollowUpPrefs): void => {
      if (!viewerId) return;
      const base = current?.viewerId === viewerId ? current.prefs : DEFAULT_PREFS;
      const next = change(base);
      publish(viewerId, next);
      void AsyncStorage.setItem(keyFor(viewerId), JSON.stringify(next)).catch(() => undefined);
    },
    [viewerId],
  );
  return { ready, prefs: ready && snapshot ? snapshot.prefs : DEFAULT_PREFS, update };
}
