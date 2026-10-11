/**
 * Which groups have news the reader has not looked at — the small dot on a
 * group's icon, the way a chat list marks an unread conversation.
 *
 * A group is unread while somebody *else* has done something in it (an expense
 * added, edited or deleted, a settlement, a comment, a member joining — every
 * row of its `activity_log`) after the reader last opened it. Their own actions
 * never light it: an expense you added from Home's quick sheet is not news to
 * you.
 *
 * "Last opened" is per device and per profile: the dot is a reading aid, not
 * shared state, so it lives in AsyncStorage (one JSON map per profile, so a
 * second account signed in on the same phone does not inherit the first one's
 * reads). Module-scoped with listeners, like the bell's `activitySeen`, so the
 * group screen marking itself seen clears the dot on Home and Groups at once.
 *
 * The rules are pure functions below; the store is the thin shell around them.
 */

import { useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** group id → ms the reader last opened it. */
export type GroupsSeen = Readonly<Record<string, number>>;

/**
 * Whether a group wears its dot: someone else acted in it after the last look.
 * An unknown last look (`undefined`: no record yet, `null`: not loaded) never
 * lights — a dot that flashes on at launch and off a beat later, or one on
 * every group on the first run, would be worse than none.
 */
export function isGroupUnread(
  newestFromOthers: number | undefined,
  seenAt: number | null | undefined,
): boolean {
  if (seenAt === null || seenAt === undefined) return false;
  return (newestFromOthers ?? 0) > seenAt;
}

/**
 * The ids, among `groupIds`, that are unread. A plain set so a row's check is
 * one lookup and the count beside "All groups" is its size.
 */
export function unreadGroupIds(
  groupIds: readonly string[],
  newestByGroup: ReadonlyMap<string, number>,
  seen: GroupsSeen | null,
): Set<string> {
  const out = new Set<string>();
  if (!seen) return out;
  for (const id of groupIds) {
    if (isGroupUnread(newestByGroup.get(id), seen[id])) out.add(id);
  }
  return out;
}

/**
 * The records to add for groups the store has never seen: each starts as read,
 * up to now or its newest row, whichever is later. On a first run that means
 * every existing group starts quiet instead of all lighting up at once; later it
 * means a group that has only just reached this phone starts quiet too, since
 * there is no telling what in it is "new" to the reader. Null when there is
 * nothing to add, so the caller can skip a write.
 */
export function seedMissing(
  groupIds: readonly string[],
  seen: GroupsSeen,
  newestByGroup: ReadonlyMap<string, number>,
  now: number,
): Record<string, number> | null {
  let added: Record<string, number> | null = null;
  for (const id of groupIds) {
    if (seen[id] !== undefined) continue;
    added ??= {};
    added[id] = Math.max(now, newestByGroup.get(id) ?? 0);
  }
  return added;
}

/**
 * `seen` with `groupId` marked read up to `at`. Never moves backwards: a mark
 * with an older time (a device clock set back) does not re-light what was
 * already read. Returns the same object when nothing changes.
 */
export function markSeenIn(seen: GroupsSeen, groupId: string, at: number): GroupsSeen {
  const prev = seen[groupId];
  if (prev !== undefined && prev >= at) return seen;
  return { ...seen, [groupId]: at };
}

/** The AsyncStorage key for one profile's reads. */
export function groupsSeenKey(profileId: string): string {
  return `groups:lastSeenAt:${profileId}`;
}

/** A stored value back into a map, dropping anything that is not a number. */
export function parseGroupsSeen(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Record<string, number> = {};
    for (const [id, at] of Object.entries(value as Record<string, unknown>)) {
      if (typeof at === 'number' && Number.isFinite(at)) out[id] = at;
    }
    return out;
  } catch {
    return {};
  }
}

// ---- The store -------------------------------------------------------------

/** profile id → its loaded map. Absent until the stored value has been read. */
const loaded = new Map<string, GroupsSeen>();
/** Marks made before the stored value was read, merged in once it is. */
const early = new Map<string, GroupsSeen>();
const loading = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function persist(profileId: string): void {
  const value = loaded.get(profileId);
  if (!value) return;
  void AsyncStorage.setItem(groupsSeenKey(profileId), JSON.stringify(value)).catch(() => {});
}

function load(profileId: string): void {
  if (loaded.has(profileId) || loading.has(profileId)) return;
  loading.add(profileId);
  void AsyncStorage.getItem(groupsSeenKey(profileId))
    .then(parseGroupsSeen, () => ({}))
    .then((stored) => {
      loading.delete(profileId);
      // A mark made while the read was in flight is newer than what was
      // stored, so it is laid over the stored map rather than lost.
      let merged: GroupsSeen = stored;
      const marks = early.get(profileId);
      if (marks) {
        for (const [id, at] of Object.entries(marks)) merged = markSeenIn(merged, id, at);
        early.delete(profileId);
      }
      loaded.set(profileId, merged);
      if (marks) persist(profileId);
      emit();
    });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** One profile's reads, or `null` while they load (or with no profile). */
export function useGroupsSeen(profileId: string | null): GroupsSeen | null {
  const snapshot = () => (profileId ? (loaded.get(profileId) ?? null) : null);
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  // Kick off the one read for this profile; `load` is idempotent, and its
  // result arrives through the listeners.
  useEffect(() => {
    if (profileId) load(profileId);
  }, [profileId]);
  return value;
}

/** The reader opened `groupId` (or its activity), up to `at` ms. */
export function markGroupSeen(profileId: string | null, groupId: string, at: number): void {
  if (!profileId || !groupId) return;
  const current = loaded.get(profileId);
  if (!current) {
    // Not read yet (a deep link straight into a group): hold the mark and
    // merge it in after the read, so a half-known map never overwrites the
    // stored one.
    early.set(profileId, markSeenIn(early.get(profileId) ?? {}, groupId, at));
    load(profileId);
    return;
  }
  const next = markSeenIn(current, groupId, at);
  if (next === current) return;
  loaded.set(profileId, next);
  persist(profileId);
  emit();
}

/** Start quiet: record the never-seen groups as read now (see `seedMissing`). */
export function seedGroupsSeen(
  profileId: string | null,
  groupIds: readonly string[],
  newestByGroup: ReadonlyMap<string, number>,
  now: number,
): void {
  if (!profileId) return;
  // Only once the stored reads are in: seeding over a not-yet-loaded map would
  // mark every group read and hide real news.
  const seen = loaded.get(profileId);
  if (!seen) return;
  const added = seedMissing(groupIds, seen, newestByGroup, now);
  if (!added) return;
  loaded.set(profileId, { ...seen, ...added });
  persist(profileId);
  emit();
}

/** Test seam: forget everything loaded. */
export function resetGroupsSeenForTests(): void {
  loaded.clear();
  early.clear();
  loading.clear();
  listeners.clear();
}
