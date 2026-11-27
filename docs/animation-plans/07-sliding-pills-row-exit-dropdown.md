# 07 - Personal screens: sliding tab pill, "Mark paid" row exit, loans dropdown origin

- **Status**: TODO (proposed, awaiting owner approval)
- **Commit**: 781ec67fe
- **Severity**: MEDIUM
- **Category**: State indication, Preventing a jarring change, Origin
- **Estimated scope**: 3 files (`app/personal/upcoming.tsx`, `app/personal/transactions.tsx`, `app/personal/loans.tsx`), about 100 lines. **Depends on plan 01** (`SPRING_SETTLE`, `EASE_OUT`). Frequency note: tab pills are tens-per-day controls, so this plan is deliberately near-imperceptible there (a calm, critically damped slide, no bounce).

## Problem

```tsx
// apps/mobile/src/app/personal/upcoming.tsx:188-216 - segmented pill, the selection is a background swap
{TABS.map(({ value, label }) => {
  const selected = value === tab;
  return (
    <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => setTab(value)}
      style={{ flex: 1, height: 36, borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center',
        backgroundColor: selected ? theme.color.brand : 'transparent' }}>
      <Text variant="caption" style={{ fontWeight: '600', color: selected ? theme.color.onBrand : theme.color.text }}>{h[label]}</Text>
```

```tsx
// upcoming.tsx:306-310 - "Mark paid": the row's source rule posts, the list shifts in one frame
onPress={() => { const { rule, date } = acting; setActing(null); void post(rule, date); }}
```

```tsx
// upcoming.tsx:100-131 render() -> <GroupRow ... /> inside the group card at :229-239 (overflow hidden)
```

```tsx
// apps/mobile/src/app/personal/transactions.tsx:405-455 - five category pills, same instant swap
<Row accessibilityRole="tablist" style={{ gap: 5 }}>
  {tabs.map((item) => { const on = item.value === tab; return (<Pressable ... style={{ flex: 1, minWidth: 0, ..., backgroundColor: on ? accent : theme.color.surface }}>
```

```tsx
// apps/mobile/src/app/personal/loans.tsx:941-975 - names dropdown: pops in, chevron swaps glyph
<Ionicons name={namesOpen ? 'chevron-up' : 'chevron-down'} size={20} color={ink} />
...
{namesOpen && others.length > 0 ? (<View style={{ borderRadius: 14, backgroundColor: theme.color.surface, borderWidth: 1, ... }}>
```

## Target

1. **Sliding pill (Upcoming, 3 tabs; Transactions, 5 pills)**: one absolutely-positioned highlight `Animated.View` (same colour and radius as today's selected background) sits under the labels, `translateX` to the selected segment's measured x, width = segment width; `withSpring(x, SPRING_SETTLE)` (`duration 350, dampingRatio 1`, no overshoot, it is a frequent control). Label colour switches over 120ms (`withTiming`, `EASE_OUT`) or simply immediately (acceptable). First render positions without animating. Reduced motion: no slide, highlight jumps (opacity not needed).
   - Upcoming: all segments are `flex: 1` in a row, so x = `index * (rowWidth - 2*padding - gaps) / count`; measure the row with `onLayout`.
   - Transactions: segments are equal `flex: 1` too (gap 5): same formula, `onLayout` on the `Row`.
   - The Transactions `accent` colour is dynamic per tab (`accent`); the highlight colour follows `accent` instantly (a colour crossfade there is not worth it).
2. **Mark paid row exit (Upcoming)**: the row being posted leaves with `exiting={FadeOut.duration(160)}`; siblings below glide with `layout={LinearTransition.springify().damping(24).stiffness(220)}`. Both must apply to the `GroupRow` list inside each group card only (rows, section headers, and cards). `GroupRow` itself (`components/home/GroupRow.tsx:99`) is an `Animated.View` from RN core `Animated`; to avoid editing it, wrap each rendered row in `<Animated.View key={row.key} exiting={...} layout={...}>` (Reanimated) inside `render()`. Reduced motion: omit both.
   - This must NOT run when the filter tab changes (rows of other tabs unmounting): add `exiting` only while a `justPosted` ref holds that row's key (set in the Mark-paid handler, cleared after 600ms); otherwise `exiting={undefined}`.
3. **Loans names dropdown**: dropdown `View` becomes `Animated.View` with `entering={FadeIn.duration(160)}` plus transform from **scale 0.97**, `transformOrigin: 'top'` (it hangs below the name field): custom entering worklet: `initialValues { opacity: 0, transform: [{ scale: 0.97 }] }`, `animations { opacity: withTiming(1, { duration: 160, easing: EASE_OUT }), transform: [{ scale: withTiming(1, { duration: 160, easing: EASE_OUT }) }] }`. Exit: `FadeOut.duration(120)`. The chevron: a single `chevron-down` icon inside an `Animated.View` rotating 0 to 180 deg over 180ms `EASE_OUT`, driven by a shared value set in an effect on `namesOpen`. Reduced motion: opacity only for the dropdown, instant chevron.

## Repo conventions to follow

- Reanimated + `useReducedMotion` as in `AppTabBar.tsx:148-170` (`useSharedValue`, `useAnimatedStyle`, `withTiming`).
- A reusable highlight is worth a tiny shared component: add `SlidingHighlight` to `apps/mobile/src/lib/anim.tsx`:

```tsx
/** The selected-segment highlight that slides between equal segments instead of swapping background. */
export function SlidingHighlight({
  index,
  count,
  width,
  color,
  radius,
  inset = 0,
  gap = 0,
  height,
}: {
  index: number;
  count: number;
  width: number;
  color: string;
  radius: number;
  inset?: number;
  gap?: number;
  height: number;
}) {
  const reduce = useReducedMotion();
  const seg = count > 0 ? (width - inset * 2 - gap * (count - 1)) / count : 0;
  const x = inset + index * (seg + gap);
  const tx = useSharedValue(x);
  const first = useRef(true);
  useEffect(() => {
    tx.set(reduce || first.current || width === 0 ? x : withSpring(x, SPRING_SETTLE));
    if (width > 0) first.current = false;
  }, [x, width, reduce, tx]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: tx.get() }] }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          top: inset,
          start: 0,
          width: seg,
          height,
          borderRadius: radius,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}
```

(RTL: `start: 0` flips the origin but `translateX` does not flip. Use `isRtlLayout() ? -x : x` for the translate and `end`-anchored position, or pass `x` already mirrored; this is the one subtle bit, test it in Arabic.) Add `useRef` to the imports there. A pure helper `segmentX(index, count, width, inset, gap)` can be added to `motionMath.ts` with a test in the existing motion test file: `segmentX(1, 3, 306, 4, 2) === 4 + 1 * ((306 - 8 - 4) / 3 + 2)`.

## Steps

1. Add `SlidingHighlight` (and the optional `segmentX` helper plus one vitest case) to `anim.tsx` / `motionMath.ts`.
2. `upcoming.tsx`: keep the `Row` (line 179) as the container, add `onLayout` to read `width`, add `<SlidingHighlight .../>` as the first child, make selected `Pressable` backgrounds transparent, keep the selected label colour switch. Inset equals the Row's `padding: 4`, gap 2, height 36, `color: theme.color.brand`, `radius: theme.radius.pill`.
3. `transactions.tsx:405`: same treatment, `inset 0`, `gap 5`, `height 36`, `radius 18`, `color: accent`. Segment contents unchanged.
4. `upcoming.tsx` Mark paid: add a `postedKey` ref set from `acting` (the row key is `row.key`; the acting object lacks it, so add `key: row.key` to the `setActing({...})` object at line 140 and to its type at line 67). Wrap `render()`'s `GroupRow` in `Animated.View` as described; `exiting`/`layout` only when `postedKey.current === row.key` for exiting, and always `layout` (reduced motion off) for siblings.
5. `loans.tsx:941-975`: implement the dropdown and chevron as described.

## Boundaries

- Do NOT animate list content when a tab changes (that list reflow is rejected in the audit).
- Do NOT use bounce on the pill (frequent control).
- Do NOT touch `GroupRow.tsx`, `PillTabBar`, `SegmentedTabs` in `packages/ui`.
- Do NOT change filtering, posting or navigation logic.
- No new dependencies. STOP if excerpts do not match.

## Verification

- **Mechanical**: `pnpm typecheck`, `pnpm lint`, `pnpm test` in `apps/mobile` (main checkout); the new `segmentX` test passes.
- **Feel check** (real device):
  - Tap between Upcoming's All / Bills / Reminders (or whatever `TABS` are): the pill glides about a third of a second and stops with no wobble. Tap three tabs in quick succession: it retargets smoothly from where it is (no restart, no jump).
  - Transactions: the pill glides under labels and takes the tab's accent colour.
  - Mark a bill paid: the row fades (about 160ms) and the rows below close the gap in one smooth settle. Switch filter tabs: rows swap instantly with no fade or glide.
  - Loans, open the name dropdown: it grows from just under the field (not the screen centre), 3% scale at most, chevron rotates. Close: quick fade.
  - Arabic: highlight lands under the right tab (mirrored).
- **Reduced motion**: highlight jumps, row simply disappears, dropdown fades only, chevron flips instantly.
- **Done when**: the three behaviours work, verified in LTR and RTL.
