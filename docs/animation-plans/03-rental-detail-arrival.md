# 03 - Rental detail: open as if it grew from the card, art settles, 12-month strip ripples in

- **Status**: TODO (proposed, awaiting owner approval)
- **Commit**: 781ec67fe
- **Severity**: HIGH
- **Category**: Missed opportunities (spatial consistency, teleporting state)
- **Estimated scope**: 2 files (`rentals/[id].tsx`, `components/wealth/PropertyArt.tsx`), about 60 lines. **Depends on plan 01** (`SPRING_SETTLE`, `EASE_OUT`). If those are not exported from `apps/mobile/src/lib/anim.tsx`, STOP.

## Problem

Tapping a property card cuts straight to a screen where the hero card, illustration, sections and the 12-month strip are all fully drawn. `DetailEnter` ("the detail screen a card opens onto, arriving as if it grew from the tap") was written for exactly this and is not used.

```tsx
// apps/mobile/src/app/rentals/[id].tsx:311-334
return (
  <Screen edges={[]}>
    <PlainHeader title={prop.name} ... />
    <ScrollView contentContainerStyle={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.lg, gap: theme.spacing.md }}>
      <StandardCard style={{ backgroundColor: theme.color.brandSoft, borderColor: theme.color.brandSoft }}>
```

```tsx
// [id].tsx:412 - the illustration, static
<PropertyArt type={prop.type} />
```

```tsx
// [id].tsx:509-537 - 12-month strip, every cell at once
<Row style={{ alignItems: 'stretch' }}>
  {strip.map((m, i) => {
    ...
    return (<View key={m.month} accessible accessibilityLabel={...} style={{ flex: 1, alignItems: 'center', gap: 6, paddingVertical: 6, borderRadius: theme.radius.md, backgroundColor: current ? theme.color.negativeSoft : undefined }}>
```

```tsx
// apps/mobile/src/lib/anim.tsx (existing, do not edit) - DetailEnter
initialValues: { opacity: 0, transform: [{ scale: 0.97 }] },
animations: { opacity: withTiming(1, { duration: 220 }), transform: [{ scale: withSpring(1, { damping: 20, stiffness: 200 }) }] },
```

## Target

1. **Screen**: the body (the `ScrollView` and the bottom action row, not the header) is wrapped in `DetailEnter`: scale 0.97 to 1 spring (damping 20, stiffness 200, existing), opacity 0 to 1 over 220ms. Origin: centre (it is a full screen, so centre is correct). The navigator's own `TRANSITION_MS = 260` slide still plays; this adds the settle on the content.
2. **Illustration** (`PropertyArt` on the detail hero only): `opacity` 0 to 1 and `translateY` 8 to 0, `withSpring(0, SPRING_SETTLE)`, delayed **80ms** after the screen enters so the card lands first and the house settles after. Opacity `withTiming(1, { duration: 200 })`.
3. **12-month strip**: each cell fades in with `opacity` 0 to 1 and `translateY` 6 to 0, `FadeInDown.duration(220).easing(EASE_OUT)`, delay `160 + i * 30` ms (12 cells, last starts at 490ms). Left to right in LTR, right to left in RTL: `Row` flips by itself, but delay by visual order, so compute the delay index as `isRtlLayout() ? strip.length - 1 - i : i` (`isRtlLayout` is exported by `@waves/ui`, used in `SwipeRow.tsx`). The strip is a single container entrance (one stagger, one purpose); it never blocks taps (cells are not interactive).
4. Reduced motion: no scale, no travel; the whole screen renders at once (`DetailEnter` already returns without `entering`), the strip and the art skip their entering.

## Repo conventions to follow

- `DetailEnter`, `Stagger`, `useReducedMotion` live in `apps/mobile/src/lib/anim.tsx` / `reducedMotion.ts`.
- Entering worklet exemplar: `detailEntering` in `anim.tsx`. For the art, add a sibling exported `settleEntering(delay)` there:

```ts
/** A picture that settles into place: rises 8px while fading in. */
export function settleEntering(delay = 0): EntryExitAnimationFunction {
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ translateY: 8 }] },
      animations: {
        opacity: withDelay(delay, withTiming(1, { duration: 200 })),
        transform: [{ translateY: withDelay(delay, withSpring(0, SPRING_SETTLE)) }],
      },
    };
  };
}
```

(`withDelay` import: add if plan 02 has not already.)

## Steps

1. `apps/mobile/src/lib/anim.tsx`: add `settleEntering` as above (exported); ensure `withDelay` is imported.
2. `apps/mobile/src/app/rentals/[id].tsx`:
   a. Imports: `Animated, { FadeInDown } from 'react-native-reanimated'`; `{ DetailEnter, EASE_OUT, settleEntering }` from `@/lib/anim`; `useReducedMotion` from `@/lib/reducedMotion`; add `isRtlLayout` to the `@waves/ui` import list.
   b. Call `const reduce = useReducedMotion();` next to the other hooks at the top of `DetailBody` (before the early `if (!prop) return`; hooks must stay above it).
   c. Wrap the `ScrollView` (line 327) and the bottom action `Row` (line 578) together in `<DetailEnter>` (it has `flex: 1`). The `PlainHeader` stays outside. The sheets and `OverflowMenu` stay outside.
   d. Line 412: replace `<PropertyArt type={prop.type} />` with `<Animated.View entering={reduce ? undefined : settleEntering(80)}><PropertyArt type={prop.type} /></Animated.View>`.
   e. Strip cell `View` at line 522: change to `Animated.View` with `entering={reduce ? undefined : FadeInDown.duration(220).easing(EASE_OUT).delay(160 + (isRtlLayout() ? strip.length - 1 - i : i) * 30)}`. Keep every existing style and accessibility prop.
3. `PropertyArt.tsx` is unchanged. Do not animate inside the SVG.

## Boundaries

- Do NOT animate `PlainHeader`, the `OverflowMenu`, any `Sheet`, the confirm card (plan 04), or the Documents/Details cards (plan 05).
- Do NOT use layout animations (`layout=`) in this plan.
- Do NOT add looping or ambient motion to the illustration (it is seen at a glance; loops on a functional screen are decoration).
- No new dependencies. STOP if excerpts do not match.

## Verification

- **Mechanical**: `pnpm typecheck`, `pnpm lint`, `pnpm test` in `apps/mobile` (main checkout).
- **Feel check** (real device):
  - Tap a property: content eases up from 97% as the screen slides in; nothing slides twice. The house settles about a beat after the card, barely perceptible but you notice the card "has life".
  - The strip ripples left to right in about half a second; open the screen on Arabic (RTL): ripples right to left, starting on the visual start edge.
  - Tap "Record rent" the instant the screen appears: the button responds immediately (entrance never blocks input).
  - Go back and open again repeatedly: no stutter, no double animation.
- **Reduced motion**: OS setting on: screen is fully drawn on the first frame.
- **Done when**: the three behaviours work in LTR and RTL; checks above pass.
