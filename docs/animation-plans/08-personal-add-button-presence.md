# 08 - Personal add button: shrink and fade when a page covers it, back in on return

- **Status**: TODO (proposed, awaiting owner approval)
- **Commit**: 781ec67fe
- **Severity**: MEDIUM
- **Category**: Spatial consistency (Missed opportunity)
- **Estimated scope**: 1 file (`apps/mobile/src/components/AppTabBar.tsx`), about 25 lines. **Depends on plan 01** (`SPRING_SETTLE`, `EASE_OUT`).

## Problem

In Personal, the round "+" button floats above the tab bar on tab roots only. It is removed for `/rentals`, `/investments`, `/personal/{loans,recurring,budgets,upcoming,setup}`, profile and settings (`personalShowsAddFab`, `apps/mobile/src/lib/personalLayoutRules.ts:18-26`). The button is conditionally rendered, so when a person taps "Rentals" it disappears in the first frame, before the new screen has even slid over, and comes back with a hard cut on return.

```tsx
// apps/mobile/src/components/AppTabBar.tsx:805-815
) : personal ? (
  personalShowsAddFab(segments) ? (
    <CenterButton action={addPersonal} />
  ) : null
) : (
  <CenterButton action={voice} />
)}
```

The surrounding mode animation (`fabStyle`, line 245) animates opacity and scale 0.6 to 1 only when the bar switches between Shared and Personal mode.

```tsx
// AppTabBar.tsx:245-248
const fabStyle = useAnimatedStyle(() => ({
  opacity: p.value,
  transform: reduced ? [] : [{ scale: 0.6 + mic.value * 0.4 }],
}));
```

## Target

Presence animates, only for the Personal add button, not for the company or shared buttons.

- Show: `opacity` 0 to 1 and `scale` 0.6 to 1, `withSpring(1, SPRING_SETTLE)` (350ms, no overshoot; this control is used tens of times a day, so no bounce).
- Hide: `opacity` to 0 and `scale` back to 0.6 over **120ms, `EASE_OUT`** (exits are quicker than entrances).
- While hidden: `pointerEvents="none"`, `accessibilityElementsHidden`, `importantForAccessibility="no-hide-descendants"`.
- Reduced motion: opacity only, 120ms, no scale.
- Origin is the existing `transformOrigin` on the FAB wrapper (`'bottom right'`, mirrored in RTL), so it shrinks toward the corner it lives in.

## Repo conventions to follow

- Same file already holds the pattern: `useSharedValue`, `useAnimatedStyle`, `withTiming`, `withSpring`, `reduced` from `useReducedMotion()` (`AppTabBar.tsx:219-248`). Add to it, do not restructure.
- Leave `p`, `mic`, `sharedStyle`, `personalStyle`, `tintStyle`, `centerStyle` and the `Easing.linear` mode switch alone (the icon stagger math depends on it; see AUDIT L2).

## Steps

1. In the component that owns lines 219-248, derive `const addVisible = personal && personalShowsAddFab(segments);` (same condition as line 813; `personal` is the local boolean the file already uses there). Add `const presence = useSharedValue(addVisible ? 1 : 0);` and an effect:

```tsx
useEffect(() => {
  presence.set(
    addVisible
      ? reduced ? withTiming(1, { duration: 120 }) : withSpring(1, SPRING_SETTLE)
      : withTiming(0, { duration: 120, easing: EASE_OUT }),
  );
}, [addVisible, reduced, presence]);
const presenceStyle = useAnimatedStyle(() => ({
  opacity: presence.get(),
  transform: reduced ? [] : [{ scale: 0.6 + presence.get() * 0.4 }],
}));
```

   Scale is `0.6 + 0.4 * presence` (min 0.6, never 0), matching the existing mode-switch FAB; the hide leg ends at 0.6 while fading out.
2. Replace lines 811-815's `personal ? (personalShowsAddFab(segments) ? <CenterButton .../> : null)` with an always-mounted wrapper for the personal case only:

```tsx
) : personal ? (
  <Animated.View
    pointerEvents={addVisible ? 'auto' : 'none'}
    accessibilityElementsHidden={!addVisible}
    importantForAccessibility={addVisible ? 'auto' : 'no-hide-descendants'}
    style={presenceStyle}
  >
    <CenterButton action={addPersonal} />
  </Animated.View>
) : (
```

   The company branch and the shared (`voice`) branch stay exactly as they are. Make sure `addPersonal` is still defined whenever `personal` is true (it is used there today).
3. `fabDrawn(...)` (line 713) is used so screens reserve room only when the button is drawn; leave it. While the button fades out the reserved room collapses at once, which is fine (the covering page is arriving).
4. Do not change `showFab(segments, company)` (line 805).

## Boundaries

- Do NOT touch `PillTabBar`, `CenterButton` or the voice (`HoldVoiceHost`) path.
- Do NOT animate the Company or Shared buttons.
- Do NOT change which screens show the button.
- No new dependencies. STOP if the excerpts do not match.

## Verification

- **Mechanical**: `pnpm typecheck`, `pnpm lint`, `pnpm test` in `apps/mobile` (main checkout; `personalLayoutRules` has tests, unchanged).
- **Feel check** (real device):
  - On Personal home, tap Rentals: the round + shrinks and fades in about 120ms while the Rentals screen slides over it; it does not vanish a beat early.
  - Press back: the button returns with a calm 350ms settle (no bounce).
  - Rapidly open and close Rentals three times: the button follows (retargets), never sticks half-visible.
  - A screen reader: the hidden button is not focusable while hidden, and is announced again when shown.
  - Taps while it is mid-fade-out do nothing (pointer events off immediately).
- **Reduced motion**: opacity fade only, 120ms.
- **Done when**: no hard cut of the Personal add button remains on any route change; the Company and Shared buttons behave as before.
