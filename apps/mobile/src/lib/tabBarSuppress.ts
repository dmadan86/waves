/**
 * A screen taking the bottom bar's room for as long as it is on screen.
 *
 * The one bar (`components/AppTabBar`) is rendered at the root over the whole
 * navigation stack, and it decides where to show from the route alone
 * (`lib/tabBar`). That is right for every case it was written for — a screen is
 * a modal or it is not — and wrong for the one case it was not: a screen that
 * grows a footer of its own *while you are on it*.
 *
 * Review is that screen. Tick a draft and an action bar appears; because it is
 * an in-tree view and the bar is a root-level one painted over the stack, the
 * two stack up — a band of actions with the navigation under it, and the raised
 * mic sitting on top of the button you were reaching for. Neither can move out
 * of the other's way by route, because the route has not changed.
 *
 * So the bar takes a second input: the screens currently asking it to stand
 * down. A list rather than a flag, because two things can ask at once (a
 * selection and a sheet) and the first to finish must not turn the bar back on
 * underneath the second. Each `suppressTabBar(scope)` returns the release for
 * its own claim, and releasing twice is harmless.
 *
 * ## Every claim names the screen that made it
 *
 * `scope` is the route the claim belongs to (`useSegments().join('/')`), and
 * the bar honours a claim only while that route is the one on screen. This is
 * the difference between a bar that can be lost and one that cannot.
 *
 * A claim used to be a bare count, on the understanding that the screen holding
 * it would always let go on the way out. Review broke that: it is a tab, tabs
 * do not unmount when you leave them, and this navigator freezes a blurred
 * tab's rendering (`(tabs)/_layout.tsx`, `freezeOnBlur`), so a screen that only
 * notices it has been left *by re-rendering* never notices at all. The claim
 * stood, and the navigation was gone from every screen in the app with nothing
 * left able to give it back — nothing short of killing the process.
 *
 * Releasing promptly is still the hook's job (`useTabBarStandDown` listens for
 * blur, which arrives whether or not rendering is frozen). The scope is what
 * makes that a matter of tidiness rather than the only thing standing between a
 * person and an app with no navigation: leave the route and the bar comes back,
 * however badly the screen behaved.
 *
 * Deliberately not a context: the bar sits above every provider a screen might
 * add and re-rendering the whole tree to hide a footer would be a lot of work
 * for one boolean. `useSyncExternalStore` is exactly the shape of this — an
 * external value, read by the one component that cares.
 */

import { useSyncExternalStore } from 'react';

/** The live claims, newest last. Rebuilt on every change so the snapshot is stable. */
let scopes: readonly string[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Ask the bottom bar to stand down while `scope` is the route on screen.
 *
 * Returns the release for *this* claim; call it when the footer goes away, and
 * on the way off the screen. Releasing twice is harmless, and a claim nobody
 * releases expires on its own the moment the route changes.
 */
export function suppressTabBar(scope: string): () => void {
  const claim = { scope };
  const live = [...scopes, claim.scope];
  scopes = live;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    // Drop one occurrence, not every matching one: two claims can share a
    // scope (a selection and a sheet on the same screen) and releasing the
    // first must not take the second with it.
    const at = scopes.indexOf(claim.scope);
    if (at >= 0) scopes = [...scopes.slice(0, at), ...scopes.slice(at + 1)];
    emit();
  };
}

/** The scopes currently asking, split out so the store can be tested without React. */
export function tabBarSuppressedSnapshot(): readonly string[] {
  return scopes;
}

/**
 * Whether the screen at `scope` is asking the bar to stand down.
 *
 * A claim from anywhere else is ignored — that is the whole point. The bar
 * asks about the route it is currently painted over, so a claim left behind on
 * a screen somebody has walked away from cannot hide it.
 */
export function useTabBarSuppressed(scope: string): boolean {
  const live = useSyncExternalStore(
    subscribe,
    tabBarSuppressedSnapshot,
    // The server snapshot: nothing has claimed anything before the first render.
    () => EMPTY,
  );
  return live.includes(scope);
}

const EMPTY: readonly string[] = [];

/** Test seam: forget every claim. Never call this from the app. */
export function resetTabBarSuppression(): void {
  scopes = [];
  emit();
}

/**
 * One screen's claim, held only while it is *both* asking and on screen.
 *
 * The store above is correct and was never the bug. The bug was in how the two
 * screens that use it decided when to let go: each held its claim in a
 * `useEffect` keyed on "are rows ticked", and trusted the cleanup to run when a
 * person walked away mid-selection. That is true of a pushed screen, which
 * unmounts when it is popped — and false of a tab, which does not unmount when
 * you leave it, and whose rendering is frozen while it is away.
 *
 * Focus is the missing input, so it is an input here rather than a rule each
 * screen re-derives, and the scope travels with it so a claim can never outlive
 * the route that made it. `set` is idempotent: calling it with the same triple
 * twice neither double-claims nor double-releases, which is what lets a hook
 * call it from an effect that runs on every render *and* from a navigation
 * listener that fires without one.
 */
export interface StandDown {
  /** Claim or release to match `active && focused`, under `scope`. Safe to repeat. */
  set: (active: boolean, focused: boolean, scope: string) => void;
  /** Let go of whatever is held. For an unmount, and safe to call twice. */
  dispose: () => void;
}

export function createStandDown(claim: (scope: string) => () => void = suppressTabBar): StandDown {
  let release: (() => void) | null = null;
  let held: string | null = null;
  const dispose = (): void => {
    if (!release) return;
    release();
    release = null;
    held = null;
  };
  return {
    set: (active, focused, scope) => {
      const wanted = active && focused;
      if (!wanted) {
        dispose();
        return;
      }
      // Already holding the right one. A screen whose route changed under it
      // (a param it navigated to itself) re-claims under the new scope, since
      // the old claim would no longer match what the bar is asking about.
      if (release && held === scope) return;
      dispose();
      release = claim(scope);
      held = scope;
    },
    dispose,
  };
}
