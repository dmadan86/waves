/**
 * Where the voice review's name corrections and aliases live: on this phone,
 * one AsyncStorage entry per signed-in person (see `voiceNames` for what is
 * kept and how it is used). Nothing leaves the device.
 */

import { useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  EMPTY_NAME_MEMORY,
  parseNameMemory,
  recordNamePick,
  type NamePick,
  type VoiceNameMemory,
} from './voiceNames';

const keyFor = (viewerId: string): string => `waves.voice_names.v1:${viewerId}`;

/** The one person's memory held in memory, so every reader sees a pick at once. */
let current: { viewerId: string; memory: VoiceNameMemory } | null = null;
const listeners = new Set<() => void>();
const loading = new Map<string, Promise<void>>();

function publish(viewerId: string, memory: VoiceNameMemory): void {
  current = { viewerId, memory };
  listeners.forEach((listener) => listener());
}

function load(viewerId: string): Promise<void> {
  if (current?.viewerId === viewerId) return Promise.resolve();
  const pending = loading.get(viewerId);
  if (pending) return pending;
  const next = (async () => {
    let memory = EMPTY_NAME_MEMORY;
    try {
      memory = parseNameMemory(await AsyncStorage.getItem(keyFor(viewerId)));
    } catch {
      // Unreadable storage: start empty; a pick writes it afresh.
    }
    // A pick that landed while this read was in flight is newer: keep it.
    if (current?.viewerId !== viewerId) publish(viewerId, memory);
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

/** This person's learned names; empty until read, and for nobody signed in. */
export function useVoiceNameMemory(viewerId: string | null | undefined): VoiceNameMemory {
  useEffect(() => {
    if (viewerId) void load(viewerId);
  }, [viewerId]);
  const snapshot = useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
  return viewerId && snapshot?.viewerId === viewerId ? snapshot.memory : EMPTY_NAME_MEMORY;
}

/**
 * The owner confirmed or corrected a heard name on the review. Applied at once
 * for every reader, then written; a failed write costs one relearned name.
 */
export async function rememberNamePick(
  viewerId: string | null | undefined,
  pick: NamePick,
): Promise<void> {
  if (!viewerId) return;
  await load(viewerId);
  const base = current?.viewerId === viewerId ? current.memory : EMPTY_NAME_MEMORY;
  const next = recordNamePick(base, pick);
  if (next === base) return;
  publish(viewerId, next);
  try {
    await AsyncStorage.setItem(keyFor(viewerId), JSON.stringify(next));
  } catch {
    // Kept for this session; relearned next time if the write never lands.
  }
}
