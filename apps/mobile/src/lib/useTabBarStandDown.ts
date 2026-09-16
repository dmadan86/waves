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
 * of killing the app.
 *
 * ## Why focus alone did not fix it
 *
 * The first fix read `useIsFocused()` and released in an effect when it went
 * false. On this navigator that effect never runs. `(tabs)/_layout.tsx` sets
 * `freezeOnBlur`, which suspends a blurred tab's rendering (react-freeze throws
 * a thenable that never resolves), so the state change `useIsFocused` makes on
 * blur does not re-render the screen and the effect keyed on it does not fire.
 * A screen that only learns it has been left by re-rendering never learns it.
 *
 * Navigation *events* are not rendering. `addListener('blur')` is a plain
 * callback on an object that outlives the freeze, so it fires on the way out
 * whatever React is doing with the subtree — which is why the claim is driven
 * from the listeners here, with the render-time effect left in only for the
 * case it is genuinely good at: the selection changing while you are looking at
 * it.
 *
 * And because a hook can always be got wrong again, the claim carries the route
 * that made it (`lib/tabBarSuppress`). Leaving the screen ends the claim's
 * jurisdiction even if nothing here runs at all.
 */

import { useEffect, useRef } from 'react';
import { useNavigation, useSegments } from 'expo-router';

import { createStandDown } from './tabBarSuppress';

/**
 * Ask the navigation to stand down while `active` and this screen is on top.
 *
 * Call it unconditionally — passing `false` is how a screen says "not now",
 * and leaving the screen releases the claim whether or not `active` ever went
 * back to false.
 */
export function useTabBarStandDown(active: boolean): void {
  const navigation = useNavigation();
  const segments = useSegments() as readonly string[];
  const scope = segments.join('/');

  const standDown = useRef<ReturnType<typeof createStandDown> | null>(null);
  standDown.current ??= createStandDown();

  // What the listeners below should claim when they fire. They are registered
  // once, so they cannot close over this render's values; a ref is how an event
  // that arrives later reads what is true now. Written in the effect rather
  // than in render, where a ref write is not allowed.
  const latest = useRef({ active, scope });

  // The selection changing while the screen is in front of you. `isFocused()`
  // is read rather than subscribed to, because the arrival and departure of
  // focus are the listeners' business — this effect only ever runs while the
  // screen is rendering, which on a frozen tab means while it is focused.
  useEffect(() => {
    latest.current = { active, scope };
    standDown.current?.set(active, navigation.isFocused(), scope);
  }, [active, navigation, scope]);

  useEffect(() => {
    const apply = (focused: boolean): void => {
      standDown.current?.set(latest.current.active, focused, latest.current.scope);
    };
    const offFocus = navigation.addListener('focus', () => apply(true));
    const offBlur = navigation.addListener('blur', () => apply(false));
    return () => {
      offFocus();
      offBlur();
      // A pushed screen is popped while focused, so this is the only thing that
      // would let go for it.
      standDown.current?.dispose();
    };
  }, [navigation]);
}
