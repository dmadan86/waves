/**
 * Where you last put an expense — the five chips on the quick-add sheet.
 *
 * The question the sheet has to answer in one glance is "which group, probably?"
 * and the honest answer is "the one you used last". Nothing in the app knew
 * that: `fetchGroups` orders by `created_at desc`, which is the newest group you
 * were *added to*, and a group made in January that you file to every day sorts
 * below one somebody added you to this morning and you have never opened.
 *
 * So the order is recorded here, on the device, as expenses are saved. Local on
 * purpose, for the same reason favourites are (see `favorites.ts`): which group
 * *you* reach for is a personal habit, not ledger state the other members need,
 * and keeping it here means no column, no migration and no round-trip before a
 * sheet can draw. It costs a reinstall — after which the sheet falls back to the
 * suggestion engine, which is what a new install shows anyway.
 *
 * A destination is stored as a key rather than a row, because rows go stale: a
 * group can be renamed, archived, left or deleted between the save that recorded
 * it and the sheet that reads it. The caller resolves each key against the
 * groups it actually has and drops what no longer resolves, so a deleted group
 * cannot come back as a chip.
 *
 * More is kept than is shown. The sheet asks for five; the store holds `CAP`, so
 * that when the top few no longer resolve there is still something behind them.
 */
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'recent.destinations';

/** How many keys are kept. Four times what the sheet shows, so filtering out
    groups that have since gone still leaves a full row. */
const CAP = 20;

/**
 * Where an expense went, as an opaque key.
 *
 * A person is not its own kind: an expense with one other person lives in the
 * 1:1 group the two of you share (ADR-006), so it is recorded as that group and
 * the sheet decides whether to draw it as a face or as a group. `personal` is
 * the one that is not a group at all — the private ledger, which is a different
 * write entirely.
 */
export type DestinationKey = `group:${string}` | 'personal';

export const PERSONAL_DESTINATION: DestinationKey = 'personal';

export function groupDestination(groupId: string): DestinationKey {
  return `group:${groupId}`;
}

/** The group id inside a key, or null when the key is not a group. */
export function destinationGroupId(key: DestinationKey): string | null {
  return key.startsWith('group:') ? key.slice('group:'.length) : null;
}

let order: DestinationKey[] = [];
let loaded = false;
// True once this run has recorded a destination. A save that lands while the
// first disk read is still in flight is newer than anything on disk, so the
// slower read must not overwrite it — the same race `favorites.ts` guards.
let touched = false;
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of listeners) listener();
};

const persist = (): void => {
  // Fire-and-forget: memory is the truth for this run, disk only carries the
  // order across a restart. A failed write costs an ordering, never an expense.
  void AsyncStorage.setItem(KEY, JSON.stringify(order)).catch(() => undefined);
};

/** Pure: the list with `key` moved to the front, deduplicated, capped. */
export function withMostRecent(
  current: readonly DestinationKey[],
  key: DestinationKey,
): DestinationKey[] {
  return [key, ...current.filter((existing) => existing !== key)].slice(0, CAP);
}

/** Read the stored order once, on first use. Idempotent — later calls no-op. */
export async function loadRecentDestinations(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw && !touched) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        order = parsed
          .filter((x): x is string => typeof x === 'string')
          .filter((x): x is DestinationKey => x === 'personal' || x.startsWith('group:'))
          .slice(0, CAP);
      }
    }
  } catch {
    // A corrupt value is no history, not a crash — unless a save already seeded
    // the order this run, in which case what just happened is the better truth.
    if (!touched) order = [];
  }
  emit();
}

/**
 * Record that an expense went here. Called on every successful save, not only
 * from the quick sheet — the order is about where your money goes, and an
 * expense typed into a group's own form says that just as loudly.
 */
export function noteDestination(key: DestinationKey): void {
  if (key !== 'personal' && destinationGroupId(key) === '') return;
  touched = true;
  order = withMostRecent(order, key);
  persist();
  emit();
}

/** Most recent first. The caller resolves these and drops what no longer exists. */
export function recentDestinations(): readonly DestinationKey[] {
  return order;
}

/** Subscribe to any change; returns an unsubscribe. */
export function subscribeRecentDestinations(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only: forget everything, as if the app had never run. */
export function __resetRecentDestinationsForTest(): void {
  order = [];
  loaded = false;
  touched = false;
  listeners.clear();
}

export interface RecentDestinations {
  /** False until the first disk read lands, so a sheet can hold its chips back
      rather than drawing the suggestion fallback and then rearranging itself. */
  readonly ready: boolean;
  readonly keys: readonly DestinationKey[];
}

export function useRecentDestinations(): RecentDestinations {
  const [, force] = useState(0);
  const [ready, setReady] = useState(loaded);

  useEffect(() => {
    const unsubscribe = subscribeRecentDestinations(() => {
      setReady(true);
      force((n) => n + 1);
    });
    void loadRecentDestinations().then(() => setReady(true));
    return unsubscribe;
  }, []);

  return { ready, keys: order };
}
