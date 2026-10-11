/**
 * The last answer this phone saw to "is Pro advanced voice on for me?", kept in
 * AsyncStorage per signed-in account.
 *
 * The live answer is a server round trip, and the QueryClient is not persisted,
 * so on a cold start the voice mic used to wait up to 1.5 s for it. With the
 * last answer to hand the mic opens at once on the engine that answer implies
 * (see `planAgentWait`); the live answer still lands and is remembered for next
 * time.
 */

import { useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { parseLastKnown } from './voiceStartPure';

const keyFor = (viewerId: string): string => `waves.voice_agent_last:${viewerId}`;

const known = new Map<string, boolean | null>();
const loading = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function publish(viewerId: string, value: boolean | null): void {
  known.set(viewerId, value);
  listeners.forEach((listener) => listener());
}

/** Read the stored answer into memory (once per account per process). */
export function loadVoiceAgentLastKnown(viewerId: string): Promise<void> {
  if (known.has(viewerId)) return Promise.resolve();
  const pending = loading.get(viewerId);
  if (pending) return pending;
  const next = (async () => {
    let value: boolean | null = null;
    try {
      value = parseLastKnown(await AsyncStorage.getItem(keyFor(viewerId)));
    } catch {
      // Unreadable storage reads as "never seen": the short wait, as before.
    }
    // A live answer may have been remembered while the read was in flight.
    if (!known.has(viewerId)) publish(viewerId, value);
  })().finally(() => loading.delete(viewerId));
  loading.set(viewerId, next);
  return next;
}

/** Remember the live answer, in memory now and on disk for the next launch. */
export function rememberVoiceAgentStatus(viewerId: string, enabled: boolean): void {
  if (known.get(viewerId) === enabled) return;
  publish(viewerId, enabled);
  void AsyncStorage.setItem(keyFor(viewerId), enabled ? 'true' : 'false').catch(() => {
    // Held for this process; the next launch just waits briefly once more.
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** This account's last-known answer, or null when none has been seen (or read yet). */
export function useVoiceAgentLastKnown(viewerId: string | null | undefined): boolean | null {
  useEffect(() => {
    if (viewerId) void loadVoiceAgentLastKnown(viewerId);
  }, [viewerId]);
  const read = (): boolean | null => (viewerId ? (known.get(viewerId) ?? null) : null);
  return useSyncExternalStore(subscribe, read, read);
}
