/**
 * Whether this account gets the demo group, and whether it has removed it.
 *
 * Modelled as a three-way decision per account, not two separate booleans,
 * because the two questions "should this account ever have seen a demo" and
 * "is it still here" are asked once each and never re-asked the second way:
 *
 * - `active`   — this account was new (no groups) the first time this ran,
 *                so it got the demo, and has not removed it. Shown forever
 *                after, even once the account has real groups of its own —
 *                removing it is something the person decides, not something
 *                that happens the moment their first real group exists (see
 *                the spec this module was written against).
 * - `skipped`  — this account already had groups the first time this build
 *                ran on it. No retroactive demo for an existing account; it
 *                never had an empty dashboard to soften in the first place.
 * - `removed`  — the person removed it. Final: nothing here ever reinstates
 *                a removed demo, on this device or (since the flag is keyed
 *                to the account, not the device) any other it signs into.
 *
 * Unset (nothing stored yet) is resolved to one of the three the first time
 * `useDemoActive` is asked for an account, and the resolution itself is
 * persisted immediately — the decision is made once, not recomputed from
 * "do I have zero groups right now" on every render, which would flip an
 * `active` demo account back out from under a `skipped` one the moment it
 * created its first real group.
 *
 * Same module shape as `lib/favorites.ts`: a framework-free singleton and a
 * subscribe/emit pair, deliberately with no React or `@/sync` import of its
 * own — a module `useSync()` itself sits above in the provider tree
 * (`@/sync/provider`'s `mutate` guard) imports this one, and a cycle back
 * through a hook here would run the whole of `react-native` through any
 * plain-module test that so much as imports this file. `useDemoActive`, the
 * hook that actually reads `hydrated` off `useSync()`, lives next door in
 * `./useDemoActive` for exactly that reason. Keyed per account (like
 * `lib/onboardingSeen.ts`), because a demo tour is shown to a person meeting
 * the app, not to whichever phone happens to be signed in.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export type DemoState = 'active' | 'skipped' | 'removed';

const keyFor = (ownerId: string): string => `waves.demo_state.${ownerId}`;

/** Resolved state per account, once known. Absent means "not read yet". */
const cache = new Map<string, DemoState>();
/** One in-flight resolution per account, so a decision is made exactly once
 *  even when several hooks ask for the same account at the same moment. */
const resolving = new Map<string, Promise<DemoState>>();
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of listeners) listener();
};

function parse(raw: string | null): DemoState | null {
  return raw === 'active' || raw === 'skipped' || raw === 'removed' ? raw : null;
}

async function readState(ownerId: string): Promise<DemoState | null> {
  try {
    return parse(await AsyncStorage.getItem(keyFor(ownerId)));
  } catch {
    return null;
  }
}

async function writeState(ownerId: string, state: DemoState): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(ownerId), state);
  } catch {
    // Best effort, like every other flag here: a failed write costs this
    // account the decision sticking past the session, not a stuck screen.
  }
}

/**
 * Resolve this account's state, deciding it for the first time if nobody
 * has yet. `isNewAccount` is only consulted on that first decision — once
 * `active` or `skipped` is stored, every later call simply returns it.
 */
export async function ensureDemoDecision(ownerId: string, isNewAccount: boolean): Promise<DemoState> {
  const known = cache.get(ownerId);
  if (known) return known;

  let pending = resolving.get(ownerId);
  if (!pending) {
    pending = (async () => {
      let state = await readState(ownerId);
      if (state === null) {
        state = isNewAccount ? 'active' : 'skipped';
        await writeState(ownerId, state);
      }
      cache.set(ownerId, state);
      resolving.delete(ownerId);
      emit();
      return state;
    })();
    resolving.set(ownerId, pending);
  }
  return pending;
}

/** The resolved state, or `null` while it is still loading / not yet asked
 *  for. Synchronous — reads the in-memory cache only. */
export function demoStateSync(ownerId: string): DemoState | null {
  return cache.get(ownerId) ?? null;
}

/** Remove the demo, for good. Updates the in-memory answer at once (so the
 *  group vanishes from every screen this render) and persists in the
 *  background, like every other write in this module. */
export async function removeDemo(ownerId: string): Promise<void> {
  cache.set(ownerId, 'removed');
  emit();
  await writeState(ownerId, 'removed');
}

export function subscribeDemoState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: forget every account's decision, as if the app had never run. */
export function __resetDemoStoreForTest(): void {
  cache.clear();
  resolving.clear();
  listeners.clear();
}
