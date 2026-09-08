/**
 * How much room the thing at the bottom of the screen has to leave beneath it.
 *
 * The design system offers two answers — `useScreenClearance`, which reserves
 * the system navigation bar, and `useTabBarClearance`, which reserves that plus
 * the app's own floating bar — and until now every screen picked one by hand.
 * Picking by hand is the bug: the bar is rendered once at the *root*, over the
 * whole navigation stack (`AppTabBar`), so it is on top of a pushed group page
 * or a personal ledger just as much as it is on top of the four tabs. Being
 * pushed is not the test, and reading it that way left seventeen screens and a
 * picker sheet ending their last row underneath the bar.
 *
 * There is one test, and it is not a judgement call: `resolveTabBar` already
 * decides whether the bar is showing on this route, because the bar itself asks
 * it. This hook asks the same question and hands back the matching number, so a
 * screen no longer has to know which of the two it is — and a screen added to
 * (or removed from) `TAB_BAR_HIDDEN_ROUTES` later gets the right foot without
 * anybody remembering to come back here.
 *
 * The rule is not new here, only named: the toast host (`lib/toast.tsx`) works
 * the same question out inline for the panel it floats, and the import screen
 * used to reason about it in a comment. Whichever of the two branches lands
 * second should hand the toast host this hook rather than keep a second copy of
 * the decision — there is nothing in its version this one does not do.
 */

import { useSegments } from 'expo-router';

import { useScreenClearance, useTabBarClearance } from '@waves/ui';

import { useAuth } from '@/lib/auth';
import { resolveTabBar } from '@/lib/tabBar';

/**
 * The foot for whatever sits last on this screen: the system navigation bar,
 * plus the app's bottom bar when the bar is drawn over this route.
 *
 * `base` is the breath below the last row on a screen the bar does not cover —
 * pass a larger one for a floating action or a pinned footer. When the bar *is*
 * covering the route the deeper of the two wins: the bar and its own breath are
 * normally more than any base a screen asks for, but a screen with a tall pinned
 * footer must not have its own request quietly dropped.
 */
export function useBottomClearance(base?: number): number {
  const { session } = useAuth();
  // Typed as a union of fixed-length route tuples, so indexing past the first
  // element trips the tuple bounds check under the CI tsconfig — the same widen
  // `AppTabBar` does for the same read.
  const segments = useSegments() as readonly string[];
  const { hidden } = resolveTabBar(segments, !session);

  // Both hooks run every render: which of the two numbers is used is a value
  // decision, never a decision about whether to call a hook.
  const screen = useScreenClearance(base);
  const overBar = useTabBarClearance();

  return hidden ? screen : Math.max(screen, overBar);
}
