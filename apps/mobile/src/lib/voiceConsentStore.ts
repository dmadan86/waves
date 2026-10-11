/**
 * Where the advanced-voice consent lives: on this phone, one AsyncStorage entry
 * per signed-in account (see `voiceConsentPure` for the rules).
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  consentState,
  grantConsent,
  parseConsent,
  revokeConsent,
  type VoiceConsentRecord,
  type VoiceConsentState,
} from './voiceConsentPure';

const keyFor = (viewerId: string): string => `waves.voice_consent:${viewerId}`;

/** What is known: a loaded record per viewer. */
let current: { viewerId: string; record: VoiceConsentRecord | null } | null = null;
const listeners = new Set<() => void>();
const loading = new Map<string, Promise<void>>();

function publish(viewerId: string, record: VoiceConsentRecord | null): void {
  current = { viewerId, record };
  listeners.forEach((listener) => listener());
}

/**
 * Read this account's stored answer into memory ahead of need — the voice mic
 * waits on it before it opens, so the app start warms it (see `useVoiceWarmup`).
 */
export function preloadVoiceConsent(viewerId: string): Promise<void> {
  return load(viewerId);
}

function load(viewerId: string): Promise<void> {
  if (current?.viewerId === viewerId) return Promise.resolve();
  const pending = loading.get(viewerId);
  if (pending) return pending;
  const next = (async () => {
    let record: VoiceConsentRecord | null = null;
    try {
      record = parseConsent(await AsyncStorage.getItem(keyFor(viewerId)));
    } catch {
      // Unreadable storage reads as "never asked": the safe side.
    }
    if (current?.viewerId !== viewerId) publish(viewerId, record);
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

async function save(viewerId: string, record: VoiceConsentRecord): Promise<void> {
  publish(viewerId, record);
  try {
    await AsyncStorage.setItem(keyFor(viewerId), JSON.stringify(record));
  } catch {
    // Held for this session; asked again next launch if the write never lands.
  }
}

export interface VoiceConsent {
  /** False until the stored answer has been read; nothing is sent meanwhile. */
  ready: boolean;
  state: VoiceConsentState;
  allow: () => void;
  revoke: () => void;
}

/** This account's consent to cloud voice; `needed` until read, and for nobody signed in. */
export function useVoiceConsent(viewerId: string | null | undefined): VoiceConsent {
  useEffect(() => {
    if (viewerId) void load(viewerId);
  }, [viewerId]);
  const snapshot = useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
  const known = !!viewerId && snapshot?.viewerId === viewerId;
  const allow = useCallback(() => {
    if (viewerId) void save(viewerId, grantConsent(Date.now()));
  }, [viewerId]);
  const revoke = useCallback(() => {
    if (viewerId) void save(viewerId, revokeConsent(Date.now()));
  }, [viewerId]);
  return {
    ready: !viewerId || known,
    state: known ? consentState(snapshot.record) : 'needed',
    allow,
    revoke,
  };
}
