/**
 * "Take the bottom of the phone while I need it" — the hook both screens use.
 *
 * Two screens grow a footer of their own while you are on them (Review's
 * selection bar, and the Bank messages screen's), and both used to hold the
 * claim in an effect keyed on the selection alone:
 *
 * ```ts
 * useEffect(() => {
 *   if (!selecting) return;
 *   return suppressTabBar();      // released on unmount, or when the tick clears
 * }, [selecting]);
 * ```
 *
 * The comment above that effect said the cleanup was what put the navigation
 * back when somebody walked away mid-selection. That was true for the pushed
 * screen and false for the tab: **a tab does not unmount when you leave it.**
 * Tick two drafts in Review, open "Add to a group", press back twice, and you
 * land on the dashboard with the claim still standing and no navigation
 * anywhere in the app — nothing on screen to release it, and no way back short
 * of killing the app. That is the whole bug, and it is why the rule now lives
 * in one place instead of being restated per screen.
 *
 * Focus is the input that was missing. `useIsFocused` re-renders the screen
 * when it comes and goes, so an ordinary effect is enough; the claim itself is
 * held by `createStandDown`, which is where the "claim once, release once"
 * bookkeeping is, and which is tested without React.
 */

import { useEffect, useRef } from 'react';
import { useIsFocused } from 'expo-router';

import { createStandDown } from './tabBarSuppress';

/**
 * Ask the navigation to stand down while `active` and this screen is focused.
 *
 * Call it unconditionally — passing `false` is how a screen says "not now",
 * and leaving the screen releases the claim whether or not `active` ever went
 * back to false.
 */
export function useTabBarStandDown(active: boolean): void {
  const focused = useIsFocused();
  const standDown = useRef<ReturnType<typeof createStandDown> | null>(null);
  standDown.current ??= createStandDown();

  useEffect(() => {
    standDown.current?.set(active, focused);
  }, [active, focused]);

  // Separate from the effect above so it runs on unmount only, rather than on
  // every change of the pair. A pushed screen still needs this: it is popped
  // while focused, so nothing else would let go.
  useEffect(() => {
    const held = standDown.current;
    return () => held?.dispose();
  }, []);
}
