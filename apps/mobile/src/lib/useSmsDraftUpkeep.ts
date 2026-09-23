/**
 * Where the local SMS draft jobs run: mounted once at the root, renders nothing.
 *
 * `smsDraftUpkeep.ts` holds the jobs; this is only the effects that trigger
 * them, for the same reason `SmsAutoRead` is a component — an effect needs a
 * component, and the jobs have to run whichever screen is open.
 */

import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { materialiseCaptures, MutationKind, SyncTable } from '@waves/core';

import { useAuth } from '@/lib/auth';
import { useLastSyncedAt, useSync } from '@/sync';

import { smsDrafts } from './smsDraftStore';
import { moveSyncedSmsDrafts, reconcileHeld } from './smsDraftUpkeep';

const MOVED_KEY = (ownerId: string): string => `waves.sms_drafts.moved.${ownerId}`;

async function moveDone(ownerId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(MOVED_KEY(ownerId))) === '1';
  } catch {
    // Unknown is not done: the move is idempotent, so running it again costs
    // a pass over the mirror and nothing else.
    return false;
  }
}

async function markMoveDone(ownerId: string): Promise<void> {
  await AsyncStorage.setItem(MOVED_KEY(ownerId), '1');
}

/** Accounts this process has already run the move for. */
const attempted = new Set<string>();

export function useSmsDraftUpkeep(): void {
  const { session, loading } = useAuth();
  const ownerId = session?.user?.id ?? '';
  const { hasSynced, mirror, queue, mutate } = useSync();
  const lastSyncedAt = useLastSyncedAt();
  const missing = useRef(new Map<string, string | null>());

  // A headless WorkManager wake-up writes drafts from its own JavaScript
  // context; coming back to the app re-reads the file so they show.
  useEffect(() => {
    if (!ownerId) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void smsDrafts.refresh(ownerId).catch(() => {});
    });
    return () => subscription.remove();
  }, [ownerId]);

  // The one-time move — Android only, where the drafts were read, and only
  // once this session's first sync has landed, so the mirror it reads is the
  // server's current answer rather than whatever the last launch left.
  useEffect(() => {
    if (loading || !ownerId || !hasSynced || Platform.OS !== 'android') return;
    if (attempted.has(ownerId)) return;
    attempted.add(ownerId);
    void moveSyncedSmsDrafts({
      ownerId,
      captures: materialiseCaptures(mirror, queue, { ownerId }),
      drafts: smsDrafts,
      deleteServerCapture: async (captureId) => {
        // Straight to the queue, never through `useDeleteCapture`: the id is a
        // local draft by now, and that hook would answer it locally.
        await mutate(MutationKind.CaptureDelete, ownerId, { captureId });
      },
      isDone: moveDone,
      markDone: markMoveDone,
    })
      .then((result) => {
        // A run that could not finish gets another go next launch.
        if (!result.done) attempted.delete(ownerId);
      })
      .catch(() => attempted.delete(ownerId));
  }, [loading, ownerId, hasSynced, mirror, queue, mutate]);

  // Held drafts: removed once their expense is on the server, reopened if it
  // was discarded.
  useEffect(() => {
    if (!ownerId) return;
    void reconcileHeld({
      ownerId,
      drafts: smsDrafts,
      isConfirmed: (expenseId) => expenseId in (mirror.tables[SyncTable.Expenses] ?? {}),
      queue,
      syncMark: lastSyncedAt,
      missing: missing.current,
    }).catch(() => {});
  }, [ownerId, mirror, queue, lastSyncedAt]);
}

/** Mounted once at the root of the app, beside `SmsAutoRead`. */
export function SmsDraftUpkeep(): null {
  useSmsDraftUpkeep();
  return null;
}
