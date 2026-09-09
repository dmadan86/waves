/* eslint-disable no-restricted-imports -- this module is the seam; it is the one place allowed to name expo-router's router. */
import { useCallback } from 'react';
import {
  router as expoRouter,
  useRouter as useExpoRouter,
  type Href,
  type ImperativeRouter,
} from 'expo-router';

// The hook by its own subpath, not the package barrel: this module is pulled
// in by pure logic that vitest loads directly, and the barrel would drag
// react-native (and its Flow syntax) into a test that only wanted a route.
import { useSingleAction } from '@waves/ui/useSingleAction';

import { createNavigationGuard } from './navigationGuard';

/**
 * The app's router.
 *
 * Identical to expo-router's, except that a forward navigation to a
 * destination it has just been asked for is dropped. Import `router` from here,
 * not from `expo-router` — the ESLint rule in `eslint.config.js` enforces it,
 * because a screen that reaches past this is a screen that opens twice on a
 * double tap.
 *
 * Wrapping rather than patching expo-router's own object on purpose: the
 * singleton is a plain mutable export today, so reassigning its methods at the
 * root would have worked and needed no call-site changes at all — and would
 * have been invisible, unsearchable, and one refactor upstream from silently
 * doing nothing. A named module that lint keeps honest is worth the import
 * sweep.
 *
 * What is *not* guarded, and why:
 *
 * - `back`, `dismiss`, `dismissAll`, `dismissTo` — leaving a screen must always
 *   be answered, and the system back gesture never reaches this module anyway.
 *   A double-tapped back button is stopped where it belongs, on the button:
 *   `useGoBack` below.
 * - `replace` — it swaps the current screen rather than stacking one, so asking
 *   twice leaves one screen either way. Guarding it would only mean remembering
 *   a redirect that expo-router had quietly dropped (its routing queue discards
 *   actions issued before the navigator mounts), and then refusing the retry.
 *
 * All four of those *clear* the record instead, because they leave the screen
 * the record was about.
 *
 * A tempting mistake, written down so it is not made later: clearing the record
 * whenever the route changes would not fix the system-back case, it would undo
 * the guard entirely. A successful push changes the route, so the reset would
 * land between the two halves of the very double tap this exists to catch. The
 * residue — system-back out of a screen and re-tap the same row inside 600ms —
 * is left alone deliberately: a push animation and a pop animation together
 * already outlast the window.
 */
const guard = createNavigationGuard();

export const router: ImperativeRouter = {
  ...expoRouter,

  push: (href, options) => {
    if (guard.allow('push', href)) expoRouter.push(href, options);
  },
  navigate: (href, options) => {
    if (guard.allow('navigate', href)) expoRouter.navigate(href, options);
  },

  replace: (href, options) => {
    guard.reset();
    expoRouter.replace(href, options);
  },
  dismissTo: (href, options) => {
    guard.reset();
    expoRouter.dismissTo(href, options);
  },
  back: () => {
    guard.reset();
    expoRouter.back();
  },
  dismiss: (count) => {
    guard.reset();
    expoRouter.dismiss(count);
  },
  dismissAll: () => {
    guard.reset();
    expoRouter.dismissAll();
  },
};

/**
 * Switching tabs, exempt from the guard.
 *
 * The bottom bar is the most rapidly tapped control in the app, and Home →
 * Friends → Home inside 600ms is three deliberate switches, not a stutter.
 * There is nothing to protect either: `tabBarRouteForSelection` already returns
 * `null` for the tab you are on, so a genuine double tap was always a no-op.
 * Dropping the third tap would only freeze the bar — its highlight is read from
 * the route, so a swallowed switch gives no feedback at all.
 */
export function switchTab(href: Href): void {
  expoRouter.navigate(href);
}

/**
 * Leaving this screen — the back chevron in a header.
 *
 * The gate is per call site, which is the whole point: two taps on *this*
 * header pop once, while racing out of a stack still works, because the header
 * on the screen underneath is a different control with its own gate. A guard on
 * `back()` itself could not tell those apart and would make the way out feel
 * broken.
 *
 * Pass `fallback` where there may be no history to pop — a cold open from a
 * notification or an invite link — and the chevron replaces to it instead of
 * silently doing nothing. That test used to be written inline at four call
 * sites, and it is exactly the test a double tap defeats: the second tap re-read
 * a `canGoBack()` that the first pop had not updated yet, so both took the same
 * branch. Now the second tap never runs.
 */
export function useGoBack(fallback?: Href): () => void {
  const leave = useCallback((): void => {
    if (fallback !== undefined && !expoRouter.canGoBack()) {
      router.replace(fallback);
      return;
    }
    router.back();
  }, [fallback]);

  return useSingleAction(leave) ?? leave;
}

/**
 * The hook form, for the handful of places that take the router from context.
 * It returns the same guarded object — expo-router's `useRouter` hands back the
 * imperative singleton, so there is nothing per-screen to preserve.
 */
export function useRouter(): ImperativeRouter {
  // Called so this stays a real hook if expo-router ever gives it per-tree
  // state; the value it returns is deliberately the guarded one.
  useExpoRouter();
  return router;
}
