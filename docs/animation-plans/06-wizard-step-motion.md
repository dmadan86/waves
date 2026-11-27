# 06 - Wizard steps: progress bar glides, the next question slides in, picked tiles respond

- **Status**: TODO (proposed, awaiting owner approval)
- **Commit**: 781ec67fe
- **Severity**: MEDIUM
- **Category**: Missed opportunities (spatial consistency, state indication)
- **Estimated scope**: 1 file (`components/wealth/parts.tsx`), about 70 lines. **Depends on plan 01** (`EASE_IN_OUT`, `EASE_OUT`, `SPRING_POP`, `PressableScale`; plan 01 step 4 already turned the `Pick` tile into a `PressableScale`).

## Problem

`FlowShell` is the single-question-per-screen shell used by the tenant flow (`TenantFlow.tsx`), the Personal setup flow and the rentals wizard pieces. Answering a question replaces the whole screen content in one frame, the progress bar jumps a step, and a tapped `Pick` tile flips background, border and icon colour instantly. The owner's rule for these flows is "nothing jumps between steps".

```tsx
// apps/mobile/src/components/wealth/parts.tsx:119-124 - progress fill, a static width
<View style={{ width: `${((index + 1) / total) * 100}%`, backgroundColor: theme.color.brand }} />
```

```tsx
// parts.tsx:140-157 - step content, swapped in place
<ScrollView keyboardShouldPersistTaps="handled" ...>
  {icon ? <StepHeader icon={icon} index={index} total={total} stepLabel={...} /> : null}
  <Text variant="title" accessibilityRole="header">{title}</Text>
  {children}
  {note ? <Text variant="caption" tone="muted">{note}</Text> : null}
</ScrollView>
```

```tsx
// parts.tsx:208-235 - Pick tile: colours flip with `selected`
<Card padded={false} style={{ ..., borderWidth: 2, borderColor: selected ? theme.color.brand : 'transparent', backgroundColor: selected ? theme.color.brandSoft : theme.color.surface }}>
  <View style={{ width: 44, height: 44, borderRadius: 22, ..., backgroundColor: selected ? theme.color.brand : tint.bg }}>
```

```tsx
// TenantFlow.tsx:77-80 - each step is a different `case` returning the same `FlowShell` type at the same position,
// so React REUSES the FlowShell instance between steps (important: its state/animated values survive)
switch (step) { case 'tenant': return (<FlowShell title={w.tenantNameQ} icon={STEP_ICON.tenant} {...base} onSkip={onSkip}> ...
```

## Target

1. **Progress**: animate to the new width: `withTiming(((index + 1) / total) * 100, { duration: 260, easing: EASE_IN_OUT })` (moving on screen = ease-in-out). First render starts at its target (no sweep on mount). Reduced motion: instant.
2. **Step content**: the block from `StepHeader` through `note` is wrapped in `Animated.View key={index}`. On each new key it enters: `opacity` 0 to 1 over 200ms and `translateX` **16 to 0** (start side: from the right in LTR, from the left in RTL) over 220ms, `EASE_OUT`. **No exit animation** (an exit would delay the next question). It does not play for the first step (mount) when `index === 0`... it plays on mount too if the shell is freshly mounted at index > 0 (a resume), which is fine. Reduced motion: opacity only, 150ms, no translate.
3. **Pick tile selection** (tap to choose; infrequent): the selected look is drawn by two absolutely-filled overlay layers whose `opacity` animates 0 to 1 over 150ms `EASE_OUT`: a `brandSoft` background layer and a 2px `brand` border ring layer. The static tile no longer changes colours. Icon bubble: when it becomes selected, `scale` 0.9 to 1 with `SPRING_POP` (small overshoot; this is a deliberate, infrequent choice). Deselect (rare): just the 150ms fade, no pop. Reduced motion: overlays use opacity (kept), no scale.
4. `ChipRow` branch of `Pick` (non-icon options) is `packages/ui`; leave it.

## Repo conventions to follow

- `useReducedMotion` from `@/lib/reducedMotion`; shared values `.get()/.set()`.
- Worklet `entering` exemplar: `detailEntering` in `apps/mobile/src/lib/anim.tsx`.
- RTL: `isRtlLayout()` from `@waves/ui` (used in `SwipeRow.tsx`, `AppTabBar.tsx`). Resolve it outside the worklet and capture the number.

## Steps

1. `parts.tsx` imports: `Animated, { useAnimatedStyle, useSharedValue, withTiming, withSpring } from 'react-native-reanimated'`, `{ EASE_IN_OUT, EASE_OUT, SPRING_POP }` from `@/lib/anim`, `useReducedMotion`, `isRtlLayout` (from `@waves/ui`), `useEffect`.
2. Add a local `ProgressFill({ pct })` component using a shared value initialised to `pct`, an effect retargeting with `withTiming(pct, { duration: 260, easing: EASE_IN_OUT })`, `useAnimatedStyle(() => ({ width: `${v.get()}%` }))`, brand background. Replace the inner `View` at lines 119-124 with `<ProgressFill pct={((index + 1) / total) * 100} />`. (Width on a 6px bar, a documented exception.)
3. Add `stepEntering(reduce)` that returns `undefined` when reduced-motion fade-only is wanted: simplest: in `FlowShell` compute `const dx = isRtlLayout() ? -16 : 16;` and `const entering = reduce ? FadeIn.duration(150) : stepIn(dx)` where `stepIn` is a module-level factory returning a worklet `{ initialValues: { opacity: 0, transform: [{ translateX: dx }] }, animations: { opacity: withTiming(1, { duration: 200 }), transform: [{ translateX: withTiming(0, { duration: 220, easing: EASE_OUT }) }] } }` (add `FadeIn` to the import).
4. In `FlowShell`, wrap lines 140-156 content (the `StepHeader`, title, `children`, `note`) in `<Animated.View key={index} entering={entering} style={{ gap: theme.spacing.lg }}>` and remove the `gap` from the `ScrollView`'s `contentContainerStyle` only if the `Animated.View` now carries it (keep `paddingBottom`).
5. Extract the icon-tile `Pick` body into `PickTile` (a function component, same props plus `selected`, `tint`, `icon`, `label`, `onPick`) so each tile owns a shared value `sel` (0/1) and a `bubble` scale value. Effect: `sel.set(withTiming(selected ? 1 : 0, { duration: 150, easing: EASE_OUT }))`; on `selected` becoming true (not on mount) `bubble.set(0.9); bubble.set(withSpring(1, SPRING_POP))`. Draw: base `Card` with `borderWidth: 2, borderColor: 'transparent', backgroundColor: theme.color.surface`; children: two `Animated.View` layers with `StyleSheet.absoluteFill`, `pointerEvents="none"`, rounded like the card, `opacity: sel`, one `backgroundColor: theme.color.brandSoft`, one `borderWidth: 2, borderColor: theme.color.brand` (put them FIRST in the card so text sits above). Bubble `View` becomes `Animated.View` with `transform: [{ scale: bubble }]` and colour `selected ? theme.color.brand : tint.bg` (a 150ms colour flip is hidden under the pop; keep it a plain colour switch).
6. Keep `accessibilityState={{ selected }}`, labels and `TILE_TINTS` logic unchanged.

## Boundaries

- Do NOT add an exit animation or any wait before the next step renders.
- Do NOT change `TenantFlow.tsx`, `setup.tsx` or flow logic, step order, or the `Button`/`onSkip`.
- Do NOT animate `TextAnswer`, `DateAnswer`, `AmountField` or the keyboard.
- Do NOT replay on every keystroke: `key` is `index` only.
- No new dependencies. STOP if excerpts do not match.

## Verification

- **Mechanical**: `pnpm typecheck`, `pnpm lint`, `pnpm test` in `apps/mobile` (main checkout).
- **Feel check** (real device, add a tenant to a property so you pass through 4 or more steps):
  - Tap Continue: the bar glides to the next notch (about a quarter second), the next question slides in about 16px from the trailing edge while fading in; you can type immediately (no input lag, keyboard stays up).
  - Go through the whole flow quickly twice: it never feels slower than before (nothing waits).
  - Tap a Pick tile: it fills softly (no flash), the icon bubble pops slightly, and it does not move other tiles. Tap another: the first fades out, the second pops.
  - Switch the app to Arabic: the question slides from the left; the bar fills in the correct direction.
  - Slow-motion: confirm there is no frame where the old and the new question are both visible (no exit overlap).
- **Reduced motion**: questions fade only, bar and tiles change without travel or pop.
- **Done when**: the three behaviours work in the tenant flow and in Personal setup (it uses `FlowShell` too; verify one step there).
