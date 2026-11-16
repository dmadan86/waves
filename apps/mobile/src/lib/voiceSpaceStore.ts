/**
 * The two per-person things voice remembers about spaces.
 *
 * - The default space: kept on the phone first (instant, offline) and mirrored
 *   into `profiles.ui_prefs.voiceDefaultSpace` so a second device picks it up;
 *   the newest `at` wins.
 * - Voice-added marks: which entries came by voice and whether they are seen
 *   (phone-local; see `voiceAdded.ts`).
 */

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { rowsFor, SyncTable } from '@waves/core';

import { useAllGroupMembers, useGroups } from '@/data/hooks';
import { isViewer } from '@/data/types';
import { useSync } from '@/sync';
import { canAddInto } from '@/lib/voiceSpace';
import { useViewerId } from '@/lib/auth';
import { patchUiPrefs, readUiPrefs } from '@/lib/uiPrefsStore';
import {
  addVoice,
  dropVoice,
  EMPTY_VOICE_ADDED,
  markSeen,
  newVoiceIds,
  type VoiceAddedState,
} from '@/lib/voiceAdded';

/** One small persisted value per signed-in person, readable from any screen. */
function profileStore<T>(prefix: string, empty: T) {
  let owner: string | null = null;
  let value = empty;
  const subs = new Set<() => void>();
  const emit = (): void => subs.forEach((fn) => fn());
  const set = (next: T): void => {
    value = next;
    emit();
    if (owner)
      void AsyncStorage.setItem(`${prefix}:${owner}`, JSON.stringify(next)).catch(() => undefined);
  };
  const load = async (profileId: string | null): Promise<void> => {
    if (owner === profileId) return;
    owner = profileId;
    value = empty;
    emit();
    if (!profileId) return;
    try {
      const raw = await AsyncStorage.getItem(`${prefix}:${profileId}`);
      if (owner === profileId && raw) {
        value = JSON.parse(raw) as T;
        emit();
      }
    } catch {
      // A bad or missing local value is the empty one.
    }
  };
  const use = (): readonly [T, (next: T) => void] => {
    const profileId = useViewerId();
    useEffect(() => void load(profileId), [profileId]);
    const current = useSyncExternalStore(
      (fn) => {
        subs.add(fn);
        return () => void subs.delete(fn);
      },
      () => value,
    );
    return [current, set];
  };
  return { use, get: () => value };
}

// ───────────────────────────────────────────────────────── default space ──

interface DefaultSpace {
  id: string | null;
  at: number;
}

const defaultStore = profileStore<DefaultSpace>('waves.voice_default', { id: null, at: 0 });

/** The space voice opens into when none is named, and how to change it. */
export function useVoiceDefaultSpace(): {
  defaultId: string | null;
  setDefault: (id: string | null) => void;
} {
  const [saved, setSaved] = defaultStore.use();
  const profileId = useViewerId();

  // Another device may have set it more recently: the newest `at` wins.
  useEffect(() => {
    if (!profileId) return;
    let live = true;
    void readUiPrefs(profileId)
      .then((prefs) => {
        const remote = prefs.voiceDefaultSpace as Partial<DefaultSpace> | undefined;
        if (live && remote && typeof remote.at === 'number' && remote.at > saved.at)
          setSaved({ id: typeof remote.id === 'string' ? remote.id : null, at: remote.at });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // Once per sign-in: later local edits are pushed by `setDefault`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  const setDefault = useCallback(
    (id: string | null): void => {
      const next = { id, at: Date.now() };
      setSaved(next);
      if (profileId) patchUiPrefs(profileId, (prefs) => ({ ...prefs, voiceDefaultSpace: next }));
    },
    [profileId, setSaved],
  );
  return { defaultId: saved.id, setDefault };
}

// ───────────────────────────────────────────────────── voice-added marks ──

const addedStore = profileStore<VoiceAddedState>('waves.voice_added', EMPTY_VOICE_ADDED);

export function useVoiceAdded(): {
  state: VoiceAddedState;
  /** Unseen voice-added ids in a space; pass the list's live ids to drop deleted ones. */
  newIds: (groupId: string, live?: ReadonlySet<string>) => string[];
  isVoice: (id: string) => boolean;
  mark: (groupId: string, ids: readonly string[]) => void;
  markSeenNow: (groupId: string) => void;
  forget: (id: string) => void;
} {
  const [state, set] = addedStore.use();
  return {
    state,
    newIds: (groupId, live) => newVoiceIds(state, groupId, live),
    isVoice: (id) => id in state.added,
    mark: (groupId, ids) => set(addVoice(addedStore.get(), groupId, ids, Date.now())),
    markSeenNow: (groupId) => set(markSeen(addedStore.get(), groupId, Date.now())),
    forget: (id) => set(dropVoice(addedStore.get(), id)),
  };
}

/**
 * Every open space the viewer is in, companies included (the expense-group hooks
 * leave those out). `ids` are the ones they may add to now: an active, non-vendor
 * member, the company not suspended or lapsed, not the demo.
 */
export function useOpenSpaces() {
  const groups = useGroups().data;
  const members = useAllGroupMembers();
  const viewerId = useViewerId();
  return useMemo(() => {
    const rows = groups.filter((row) => !row.archived_at);
    const ids = new Set(
      rows
        .filter((row) =>
          canAddInto(
            row,
            members.find((m) => m.group_id === row.id && isViewer(m, viewerId) && !m.left_at)
              ?.role ?? null,
          ),
        )
        .map((row) => row.id),
    );
    return { rows, ids };
  }, [groups, members, viewerId]);
}

/** Unseen voice-added entries in a space that still exist (queued or synced, not deleted). */
export function useVoiceNewCount(): (groupId: string) => number {
  const { newIds } = useVoiceAdded();
  const { mirror, queue } = useSync();
  return (groupId) => {
    if (newIds(groupId).length === 0) return 0;
    const live = new Set<string>();
    for (const table of [SyncTable.Expenses, SyncTable.CompanyEntries])
      for (const row of rowsFor(mirror, table, groupId))
        if (!row.deleted_at) live.add(row.id as string);
    for (const m of queue)
      if (m.groupId === groupId) {
        const payload = m.payload as { expenseId?: string; entryId?: string };
        const id = payload.expenseId ?? payload.entryId;
        if (id) live.add(id);
      }
    return newIds(groupId, live).length;
  };
}
