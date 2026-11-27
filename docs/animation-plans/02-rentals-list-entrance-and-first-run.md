# 02 - Rentals list: staggered arrival, rent-collected bar fill, first-run empty state

- **Status**: TODO (proposed, awaiting owner approval)
- **Commit**: 781ec67fe
- **Severity**: HIGH
- **Category**: Missed opportunities (teleporting state, rare delight moment)
- **Estimated scope**: 3 files (`rentals/index.tsx`, `investments/index.tsx`, `lib/anim.tsx`), about 90 lines. **Depends on plan 01** (tokens `EASE_OUT`, `SPRING_SETTLE`, `SPRING_POP`). If `EASE_OUT` is not exported from `apps/mobile/src/lib/anim.tsx`, STOP.

## Problem

The Rentals screen shows its month summary and every property card in one frame. The "collected this month" bar is drawn already full. The first-run empty state (the screen every new user sees) is a static icon. This is the "very plain, no life" the owner described. `Stagger` is built in `lib/anim.tsx` and unused.

```tsx
// apps/mobile/src/app/rentals/index.tsx:177-200 - summary card, bar drawn at its final width
<StandardCard style={{ gap: theme.spacing.md }}>
  <Text variant="body" style={{ fontWeight: '700' }}>{w.thisMonth}</Text>
  ...
  <View accessible accessibilityRole="progressbar" ... style={{ height: 8, borderRadius: 4, flexDirection: 'row', overflow: 'hidden', backgroundColor: theme.color.surfaceMuted }}>
    <View style={{ width: `${totals.percent}%`, backgroundColor: theme.color.brand }} />
  </View>
```

```tsx
// rentals/index.tsx:214-222 - property cards, all at once
<Text variant="body" style={{ fontWeight: '700' }}>{fill(w.propertiesCount, { n: active.length })}</Text>
{views.map(({ p, v }) => { ... return (<PressableScale key={p.id} ...> // after plan 01
```

```tsx
// rentals/index.tsx:116-142 - empty state, static
<View style={{ width: 120, height: 110 }}>
  <Ionicons name="home-outline" size={96} color={theme.color.brand} />
  <View style={{ position: 'absolute', end: 0, bottom: 0, width: 52, height: 52, borderRadius: 26, ... backgroundColor: theme.color.bg }}>
    <Ionicons name="key-outline" size={40} color={theme.color.brand} />
  </View>
</View>
<Text variant="title" ...>{w.trackRentTitle}</Text>
<Text variant="body" tone="muted" ...>{w.trackRentSub}</Text>
<View style={{ alignSelf: 'center', width: '70%', marginTop: theme.spacing.md }}><Button label={w.addProperty} fullWidth onPress={add} /></View>
```

## Target

All motion plays once on mount. Nothing replays on refetch (keys are stable) or when data changes.

1. **Cards**: summary card is `Stagger index={0}`; the "N properties" label `index={1}`; property card `i` is `Stagger index={i + 2}`. (`Stagger` after plan 01: `FadeInDown`, 260ms, `EASE_OUT`, delay `index * 55ms` capped at index 8, 25px default travel; the 8-step cap keeps a long list inside about 440ms.)
2. **Progress fill**: bar goes from 0 to `totals.percent` over **600ms, `EASE_OUT`, delayed 120ms** on first mount only (so it starts as the card lands); later `percent` changes retarget over 400ms with no delay. Animates `width` (a layout property, accepted here: an 8px bar, once per visit, documented exception). Reduced motion: set instantly.
3. **Empty state** (rare, first-run: delight allowed):
   - house icon: `opacity` 0 to 1, `translateY` 12 to 0, `withSpring(..., SPRING_SETTLE)`, delay 0.
   - key badge: `opacity` 0 to 1, `scale` **0.6** to 1 (never from 0), `withSpring(..., SPRING_POP)`, delay 160ms.
   - title, subtitle, button: `FadeInDown.duration(260).easing(EASE_OUT)`, delays 240, 300, 360ms.
   - Reduced motion: none of the above, plain render (house/key/title all visible immediately).

Add to `anim.tsx` a reusable worklet for the pop (also used by plan 04):

```ts
/** A small element arriving with a pop: starts at 60% and a touch transparent, overshoots slightly. */
export function popEntering(delay = 0): EntryExitAnimationFunction {
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ scale: 0.6 }] },
      animations: {
        opacity: withDelay(delay, withTiming(1, { duration: 140 })),
        transform: [{ scale: withDelay(delay, withSpring(1, SPRING_POP)) }],
      },
    };
  };
}
```

(add `withDelay` to the Reanimated import; the closure captures `delay`, and `SPRING_POP` is a plain object, both safe in a worklet.)

## Repo conventions to follow

- Exemplar for a custom entering worklet: `detailEntering` at the bottom of `apps/mobile/src/lib/anim.tsx`.
- Exemplar for `.get()/.set()` shared values and `useReducedMotion`: `useCrossfade` in the same file.
- Imports use `@/lib/anim`, `@/lib/reducedMotion`.
- `Stagger` already reads `useReducedMotion` and returns a plain `Animated.View` without `entering` when reduced.

## Steps

1. `apps/mobile/src/lib/anim.tsx`: add `withDelay` to the import, add `popEntering` as above, exported.
2. `apps/mobile/src/app/rentals/index.tsx`: add imports `Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated'`, `useEffect, useRef` from `react`, `{ EASE_OUT, popEntering, SPRING_SETTLE, Stagger }` from `@/lib/anim`, `useReducedMotion` from `@/lib/reducedMotion`.
3. Add a local component in that file, above `RentalsBody`:

```tsx
function FillBar({ percent }: { percent: number }) {
  const reduce = useReducedMotion();
  const first = useRef(true);
  const p = useSharedValue(reduce ? percent : 0);
  useEffect(() => {
    if (reduce) {
      p.set(percent);
      return;
    }
    const move = withTiming(percent, { duration: first.current ? 600 : 400, easing: EASE_OUT });
    p.set(first.current ? withDelay(120, move) : move);
    first.current = false;
  }, [percent, reduce, p]);
  const style = useAnimatedStyle(() => ({ width: `${p.get()}%` }));
  return <Animated.View style={[{ backgroundColor: theme.color.brand }, style]} />;
}
```

`theme` is not in scope there: call `const theme = useTheme();` inside `FillBar`. 4. Replace line 199 (`<View style={{ width: ..., backgroundColor: theme.color.brand }} />`) with `<FillBar percent={totals.percent} />`. Keep the surrounding `progressbar` View and its accessibility props unchanged. 5. Wrap, in the non-empty return: the summary `StandardCard` in `<Stagger index={0}>`, the `propertiesCount` `Text` in `<Stagger index={1}>`, and each property `PressableScale` in `<Stagger key={p.id} index={i + 2}>` (move `key` to the `Stagger`; use the map index). The `lock` row above the card stays unwrapped. 6. Empty state (lines 116-142): wrap the house `Ionicons` in an `Animated.View` with `entering={reduce ? undefined : houseEntering}` where `houseEntering` is a module-level worklet (same shape as `detailEntering`: `initialValues { opacity: 0, transform: [{ translateY: 12 }] }`, animations `opacity: withTiming(1, { duration: 200 })`, `transform: [{ translateY: withSpring(0, SPRING_SETTLE) }]`). Key badge `View` becomes `Animated.View entering={reduce ? undefined : popEntering(160)}` (keep its style). The three text/button blocks become `Animated.View` with `entering={reduce ? undefined : FadeInDown.duration(260).easing(EASE_OUT).delay(240 | 300 | 360)}`. Get `reduce` from `useReducedMotion()` at the top of `RentalsBody`. Export `houseEntering` from `anim.tsx` rather than the screen if you prefer; either is fine. 7. `apps/mobile/src/app/investments/index.tsx:112`: wrap each `groups.map` group `View` (key `g.type`) in `<Stagger index={gi}>` (use the map index). Do not wrap individual `ListRow`s.

## Boundaries

- Do NOT add `Stagger` to Upcoming, Transactions, Recurring or Loans (frequent, filter-driven lists; see AUDIT "Rejected").
- Do NOT animate money text or counts.
- Do NOT replay entrances on focus (no `useFocusEffect`).
- Do NOT touch `StandardCard`, `PlainHeader`, or `packages/ui`.
- No new dependencies. If excerpts do not match, STOP.

## Verification

- **Mechanical**: in `apps/mobile` from the main checkout run `pnpm typecheck`, `pnpm lint`, `pnpm test`.
- **Feel check** (real device):
  - Open Rentals with 3 or more properties: summary card arrives first, then the label, then the cards cascade about 55ms apart, 12 to 25px upward travel, settling with no overshoot. The whole cascade finishes in under half a second; you can already tap the first card while the last is still settling.
  - The blue bar sweeps from empty to its value, starting just after the card lands, fast then slow (ease-out). Record a rent, come back: no replay, bar just retargets.
  - Pull to refresh or toggle airplane mode: cards do NOT re-animate.
  - Delete all properties to reach the empty state: house rises, key pops with a small overshoot (about 5%), text follows. Plays once, never again until the screen is reopened.
  - Slow-motion: at 10x animation scale confirm the key never starts from a dot (min scale 0.6).
- **Reduced motion**: with the OS setting on, everything is simply there on first frame; the bar is at its final width.
- **Done when**: the three behaviours above work, nothing animates on re-render, lint/typecheck/tests pass.
