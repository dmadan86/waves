# 04 - The "rent received" moment: card collapses, number crossfades, check pops, one haptic

- **Status**: TODO (proposed, awaiting owner approval)
- **Commit**: 781ec67fe
- **Severity**: HIGH
- **Category**: Missed opportunities (rare, high-emotion moment) and Preventing a jarring change
- **Estimated scope**: 1 file (`rentals/[id].tsx`), about 70 lines. **Depends on plan 01** (tokens) and **plan 02** (`popEntering` exported from `anim.tsx`). If either is missing, STOP. Plan 03 is not required but touches the same file: apply 03 first to avoid conflicts, then re-read line numbers.

## Problem

When the owner taps "Yes, received" (or records a payment through the sheet) the money has arrived, which is the whole point of the product, and the screen reacts in one silent frame: the confirm card disappears, the cards below jump up, the big "rent due" number swaps, a green check appears in the strip.

```tsx
// apps/mobile/src/app/rentals/[id].tsx:418-460 - the confirm card, removed by a conditional
{tn && unpaid && asked ? (
  <StandardCard style={{ gap: theme.spacing.md }}>
    ...
    <Button label={w.yesReceived} ... onPress={() => record(remaining, today)} />
    ...
    <TintButton label={w.notYet} ... onPress={() => setAsked(false)} />
  </StandardCard>
) : null}
```

```tsx
// [id].tsx:344-346 - the hero figure
<Text variant="title" style={{ fontWeight: '800', fontSize: 34, lineHeight: 40 }}>
  {fmt(remaining, cur)}
</Text>
```

```tsx
// [id].tsx:538-551 - the current month cell's check
<View style={{ width: 18, height: 14, borderRadius: 5, ..., backgroundColor: mark === 'check' ? GREEN_TINT : theme.color.surfaceMuted }}>
  {mark === 'check' ? <Ionicons name="checkmark" size={11} color={GREEN} /> : null}
</View>
```

## Target

All four happen together, within about 450ms, only after a real state change (not on mount).

1. **Confirm card exit**: `exiting={FadeOut.duration(160)}` (opacity 1 to 0; no scale, no slide: it is leaving on its own accord and a fade reads as "done"). Reduced motion: same 160ms fade (opacity is comprehension, kept).
2. **Siblings glide up** instead of jumping: every direct child of the scroll content that sits below the card gets `layout={LinearTransition.springify().damping(24).stiffness(220)}` (critically damped, no overshoot). Reduced motion: omit `layout` (they jump, as today).
3. **Hero figure crossfade**: the old and new figure dissolve in place over 180ms using the existing `useCrossfade` approach: keep the previous string mounted under the new one and cross their opacities. Implementation: a small `SwapText` component below; reduced motion: instant.
4. **Strip check pops**: when the current month's `mark` changes to `'check'`, the check icon and tint pop in: `popEntering(120)` from `anim.tsx` (scale 0.6 to 1 with `SPRING_POP`, opacity 0 to 1). It must NOT play on screen mount for months that are already paid (that is plan 03's ripple): only on transition. Track with a ref of the previous mark.
5. **Haptic**: `Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)` once, fired in `record()` right after the write is kicked off. Wrap in the same guard `lib/assistantHaptics.ts` uses (check that file first and reuse its helper/export if it fits; if it does not export a success helper, import `expo-haptics` directly and call it in a try/catch).

## Repo conventions to follow

- `useCrossfade` (`anim.tsx:39`) is the crossfade device; this plan applies the same two-layer technique to a text pair: both stay mounted, fixed layout, so the swap never causes a layout jump.
- Layout animations: `LinearTransition` from `react-native-reanimated`. Use the `.springify()` builder.
- Haptics: `apps/mobile/src/lib/assistantHaptics.ts` (read it, copy its style).

## Steps

1. `apps/mobile/src/app/rentals/[id].tsx`: add imports `Animated, { FadeOut, LinearTransition, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'`, `* as Haptics from 'expo-haptics'` (or the `assistantHaptics` helper), `{ popEntering }` from `@/lib/anim`. (`reduce` from `useReducedMotion()` is added by plan 03; if plan 03 is not applied add `const reduce = useReducedMotion();` above the early return.)
2. Confirm card: change `<StandardCard ...>` at line 419 to be wrapped: `<Animated.View exiting={FadeOut.duration(160)}>` around it. Keep `{tn && unpaid && asked ? (...) : null}` as is (Reanimated plays `exiting` when the element unmounts).
3. Siblings: give these `layout={reduce ? undefined : LinearTransition.springify().damping(24).stiffness(220)}` by wrapping each in `Animated.View`: the `RaiseCard` block (line 416), the facts `StandardCard` (462), `DocumentsCard` (502), `DetailsCard` (503), and the strip section `View` (506). The hero card (334) also gets it, since its height changes with the figure. Keep the ScrollView `gap` on the container; wrappers must not add margin.
4. Hero figure: replace the `Text` at 344-346 with `<SwapText value={fmt(remaining, cur)} />`:

```tsx
function SwapText({ value }: { value: string }) {
  const reduce = useReducedMotion();
  const [prev, setPrev] = useState(value);
  const mix = useSharedValue(1);
  const shown = useRef(value);
  useEffect(() => {
    if (shown.current === value) return;
    setPrev(shown.current);
    shown.current = value;
    mix.set(reduce ? 1 : 0);
    if (!reduce) mix.set(withTiming(1, { duration: 180 }));
  }, [value, reduce, mix]);
  const next = useAnimatedStyle(() => ({ opacity: mix.get() }));
  const old = useAnimatedStyle(() => ({ opacity: 1 - mix.get(), position: 'absolute' }));
  const style = { fontWeight: '800', fontSize: 34, lineHeight: 40 } as const;
  return (
    <View>
      <Animated.View style={old} pointerEvents="none">
        <Text variant="title" style={style}>
          {prev}
        </Text>
      </Animated.View>
      <Animated.View style={next}>
        <Text variant="title" style={style}>
          {value}
        </Text>
      </Animated.View>
    </View>
  );
}
```

Imports needed: `useEffect, useRef, useState`. The accessible text is the real `Text`; mark the old layer `accessibilityElementsHidden importantForAccessibility="no-hide-descendants"`. 5. Strip check: in the `strip.map`, keep `const prevMarks = useRef<Record<string, string>>({})` declared ABOVE the early return in `DetailBody` (hooks order). After rendering, an effect sets `prevMarks.current[m.month] = mark` per cell. A cell is "newly checked" when the stored mark exists and is not `'check'` and the current one is. Render the check `Ionicons` as `<Animated.View entering={popEntering(120)}>` only for newly checked cells; all other cells render the plain icon as today. (Simple form: keep `Set` of months that flipped, computed in an effect with `useState`, cleared after 600ms.) 6. Haptic: in `record` (line 194) after `void writes.recordRent(...)`: fire the success haptic. Do not fire it from the sheet's cancel path.

## Boundaries

- Do NOT animate the amount counting up or down; only the one-off crossfade.
- Do NOT add confetti, particles or sound. A green pop plus a haptic is the ceiling.
- Do NOT change `writes.recordRent`, `record`'s logic, amounts or ids.
- Do NOT use `scale(0)` anywhere (`popEntering` starts at 0.6).
- No new dependencies (`expo-haptics` is already installed). STOP if excerpts do not match.

## Verification

- **Mechanical**: `pnpm typecheck`, `pnpm lint`, `pnpm test` in `apps/mobile` (main checkout). Unit tests unaffected; none needed (no new pure logic).
- **Feel check** (real device, haptics cannot be judged in a simulator):
  - Tap "Yes, received": one soft success tap; the card fades in about 160ms; the cards below glide up in one smooth settle (no bounce, no jump); the big number dissolves old to new; the strip's green check pops with a small overshoot.
  - Tap "Not yet": card just dismisses and the content glides up; no haptic, no check, no crossfade (nothing changed financially).
  - Open an already-paid property: no pop, no glide (these only run on a change).
  - Tap "Yes, received" twice fast: no double haptic (the repo's one-tap gate and `record` guard already handle it; confirm no extra animation restarts).
  - Slow-motion at 10x: the glide ends exactly when the card is gone; no frame where two numbers are both fully opaque (they overlap at most about 50% each).
- **Reduced motion**: card fades out, numbers swap instantly, check appears without pop, content jumps without glide, haptic still fires (haptics are not motion).
- **Done when**: the five behaviours run on a real payment and only then.
