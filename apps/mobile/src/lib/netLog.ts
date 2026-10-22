/**
 * The network log's device half: wraps `fetch` once, keeps the list in memory,
 * saves it to the phone in batches, and lets the Network activity screen read
 * it. What may be recorded, and what may not, is decided in `netLogCore`.
 *
 * It is kept on this phone and never uploaded — nothing here reaches a server,
 * and the wrapper must never throw, delay a request or change one.
 *
 * Not seen: images and tiles drawn by native views, and the connections the
 * purchases, crash-reporting and Google sign-in SDKs make from their own native
 * code. The screen says so.
 */

import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Network from 'expo-network';
import { AppState } from 'react-native';

import { DEFAULT_TILE_URL } from '@/lib/mapTiles';

import {
  appendEntry,
  countSync,
  EMPTY_SYNC_STATS,
  parseStoredLog,
  parseSyncStats,
  pruneSyncStats,
  type SyncStats,
  toEntry,
  trimLog,
  urlParts,
  wrapFetch,
  type NetLogEntry,
  type RawCall,
} from './netLogCore';

const STORAGE_KEY = 'waves.netLog.v1';
const SYNC_KEY = 'waves.netLog.sync.v1';
const SAVE_DELAY_MS = 4000;

let entries: NetLogEntry[] = [];
let syncStats: SyncStats = EMPTY_SYNC_STATS;
let loaded = false;
let loading: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let installed = false;
const listeners = new Set<() => void>();

const mapHosts: string[] = (() => {
  const host = urlParts(DEFAULT_TILE_URL.replace(/\{[a-z]\}/g, 'x'))?.host;
  return host ? [host] : [];
})();

function notify(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // A listener's fault is its own.
    }
  }
}

async function save(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!loaded) return;
  try {
    const now = Date.now();
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(trimLog(entries, now)));
    await AsyncStorage.setItem(SYNC_KEY, JSON.stringify(pruneSyncStats(syncStats, now)));
  } catch {
    // Losing a save only loses log lines.
  }
}

function scheduleSave(): void {
  if (saveTimer || !loaded) return;
  saveTimer = setTimeout(() => void save(), SAVE_DELAY_MS);
}

/** Read the saved list once, folding in anything recorded before it arrived. */
export function loadNetLog(): Promise<void> {
  loading ??= (async () => {
    try {
      const now = Date.now();
      const stored = parseStoredLog(await AsyncStorage.getItem(STORAGE_KEY));
      const storedSync = parseSyncStats(await AsyncStorage.getItem(SYNC_KEY));
      // Merge the counts saved earlier with any counted before they arrived.
      const days = { ...storedSync.days };
      for (const [day, n] of Object.entries(syncStats.days)) days[day] = (days[day] ?? 0) + n;
      syncStats = pruneSyncStats({ days, last: Math.max(storedSync.last, syncStats.last) }, now);
      // Sync calls saved one by one by an earlier version become counts.
      const legacy = stored.filter((e) => e.p === 'sync');
      for (const e of legacy) syncStats = countSync(syncStats, e.t, now);
      entries = trimLog(
        [...stored.filter((e) => e.p !== 'sync'), ...entries].sort((a, b) => a.t - b.t),
        now,
      );
    } catch {
      // Start from what this run has seen.
    }
    loaded = true;
    if (entries.length || Object.keys(syncStats.days).length) scheduleSave();
    notify();
  })();
  return loading;
}

function record(call: RawCall, offline: boolean): void {
  const entry = toEntry(call, { offline, skipLocal: __DEV__, mapHosts });
  if (!entry) return;
  if (entry.p === 'sync') {
    // Sync is only counted, never kept call by call.
    syncStats = countSync(syncStats, entry.t, Date.now());
    scheduleSave();
    notify();
    return;
  }
  entries = appendEntry(entries, entry, Date.now());
  scheduleSave();
  notify();
}

function onCall(call: RawCall): void {
  if (call.status !== null) {
    record(call, false);
    return;
  }
  // A call that threw: ask, off the request's path, whether the phone was
  // offline. Failing to ask just files it as failed.
  void Network.getNetworkStateAsync().then(
    (state) => record(call, state.isConnected === false),
    () => record(call, false),
  );
}

/** Wrap `fetch` once. Safe to call again; does nothing the second time. */
export function installNetLog(): void {
  if (installed) return;
  installed = true;
  try {
    if (typeof globalThis.fetch !== 'function') return;
    // Wrap before the first call so nothing is missed; the saved list joins in.
    globalThis.fetch = wrapFetch(globalThis.fetch.bind(globalThis), onCall);
    void loadNetLog();
    AppState.addEventListener('change', (state) => {
      if (state !== 'active') void save();
    });
  } catch {
    // The log is optional; the app is not.
  }
}

/** Forget everything, here and on disk. */
export async function clearNetLog(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  entries = [];
  syncStats = EMPTY_SYNC_STATS;
  notify();
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
    await AsyncStorage.removeItem(SYNC_KEY);
  } catch {
    // Already gone from memory.
  }
}

export function subscribeNetLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSyncStats(): SyncStats {
  return syncStats;
}

/** The sync counts, re-rendering when they change. */
export function useSyncStats(): SyncStats {
  return useSyncExternalStore(subscribeNetLog, getSyncStats, getSyncStats);
}

export function getNetLog(): readonly NetLogEntry[] {
  return entries;
}

/** The current list (oldest first), re-rendering when it changes. */
export function useNetLog(): readonly NetLogEntry[] {
  return useSyncExternalStore(subscribeNetLog, getNetLog, getNetLog);
}
