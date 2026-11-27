# 05 - Documents grid: filled tiles arrive, thumbnails fade in, busy state is visible

- **Status**: TODO (proposed, awaiting owner approval)
- **Commit**: 781ec67fe
- **Severity**: MEDIUM
- **Category**: Missed opportunities (teleporting state) and Feedback
- **Estimated scope**: 1 file (`components/wealth/RentalExtras.tsx`), about 40 lines. **Depends on plan 01** (tokens; and `PressableScale` already applied to the tiles by plan 01 step 6).

## Problem

In `DocumentsCard` the slot grid changes state with no bridge: add a file and the dashed empty tile is replaced by a filled tile in one frame; the thumbnail pops in whenever the image decodes; while a photo or scan is being processed (`busy`) nothing on screen changes at all, so a slow pick looks like a frozen app; removing a file makes the tile snap back to empty.

```tsx
// apps/mobile/src/components/wealth/RentalExtras.tsx:446-451 (emptyTile) and :494 (filled tile)
const emptyTile = (key, name, label, onPress) => (
  <Pressable key={key} accessibilityRole="button" accessibilityLabel={label} disabled={busy} onPress={onPress}
    style={{ ...tileBase, alignItems: 'center', justifyContent: 'center', ..., borderWidth: 1.5, borderStyle: 'dashed', ... }}>
```

```tsx
// RentalExtras.tsx:516-521 - thumbnail
<Image
  source={{ uri: localDocUri(propertyId, first) }}
  style={{ width: '100%', height: '100%' }}
  contentFit="cover"
  accessibilityIgnoresInvertColors
/>
```

```tsx
// RentalExtras.tsx:482-492 - the grid container
<View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
  {slots.map((s) => { ... if (s.docs.length === 0) return emptyTile(...); ... return (<Pressable key={s.id} ...>
```

## Target

Documents are added or removed rarely (a few times per property, ever), so motion is allowed but short.

1. **Tile arrives**: a filled tile that appears because a file was just added: `opacity` 0 to 1 and `scale` 0.96 to 1 with `SPRING_SETTLE` (no bounce). Mount of the whole screen is NOT an "add": plain tiles that are already filled at mount skip it (plan 03's `DetailEnter` already handles screen arrival). Track by comparing the set of filled slot ids against the previous render.
2. **Thumbnail**: `expo-image` `transition={180}` (a built-in cross-dissolve; `Image` already imported from `expo-image` at line 9) on both `Image` uses (`:516` grid, `:682` viewer).
3. **Busy**: while `busy` is true, all tiles ease to `opacity` 0.6 over 120ms, back to 1 over 160ms when it ends (`withTiming`, `EASE_OUT`). Plus: `pointerEvents` unchanged (already `disabled={busy}`). Reduced motion: same opacity (it is comprehension, not travel), 0 duration is acceptable; keep it.
4. **Tile removed**: filled tile `exiting={FadeOut.duration(150)}`; the neighbours reflow with `layout={LinearTransition.springify().damping(24).stiffness(220)}`. Reduced motion: fade only, no `layout`.
5. Do NOT animate the long-press itself or the `viewing` Sheet (the Sheet has its own spring).

## Repo conventions to follow

- `PressableScale` for the tile press (plan 01).
- Layout/exiting builders from `react-native-reanimated`; check `reduceMotion` via `useReducedMotion` from `@/lib/reducedMotion`.
- Shared values: `.get()/.set()`.

## Steps

1. `RentalExtras.tsx`: imports `Animated, { FadeOut, LinearTransition, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'`, `{ EASE_OUT, SPRING_SETTLE }` from `@/lib/anim`, `useReducedMotion`.
2. In `DocumentsCard`, add `const reduce = useReducedMotion();` and `const dim = useSharedValue(1); useEffect(() => { dim.set(withTiming(busy ? 0.6 : 1, { duration: busy ? 120 : 160, easing: EASE_OUT })); }, [busy, dim]); const dimStyle = useAnimatedStyle(() => ({ opacity: dim.get() }));` Apply `dimStyle` by making the grid container (line 482) an `Animated.View` with `style={[existing, dimStyle]}`.
3. Make the grid container's tiles layout-aware: give each tile wrapper `layout={reduce ? undefined : LinearTransition.springify().damping(24).stiffness(220)}`. Because tiles are `PressableScale` (an `Animated` pressable) this works if you pass `layout` as a prop through `...rest`; if `PressableScale` does not forward it, wrap each tile in `<Animated.View key=... layout=... exiting=... style={{ width: tile width }}>`. Read how `tileBase` sets width (it uses `width` state from `onLayout`) and keep that width on the wrapper, not inside it.
4. Arrival: keep `const seen = useRef<Set<string> | null>(null)`. After first render with data, store the filled ids; on later renders a filled id not in `seen` is "new". For new tiles pass `entering={reduce ? undefined : tileEntering}` where `tileEntering` is a module-level worklet with `initialValues { opacity: 0, transform: [{ scale: 0.96 }] }` and `animations { opacity: withTiming(1, { duration: 180 }), transform: [{ scale: withSpring(1, SPRING_SETTLE) }] }`. Set `seen` in an effect after each render. Skip arrival for the very first data render (when `seen.current` is null).
5. Add `transition={180}` to both `<Image>` elements.
6. Tile exit: add `exiting={reduce ? undefined : FadeOut.duration(150)}` to filled tile wrappers. Replacing a filled tile with an empty tile (remove) then fades the old one while the empty one is already in place: acceptable.

## Boundaries

- Do NOT touch `DetailsCard`, `TextSheet`, picker or `propertyDocs` logic.
- Do NOT delay or gate any press while an animation plays.
- Do NOT animate the viewer sheet contents.
- No new dependencies. STOP if the layout of `tileBase` or the width logic differs from the excerpts.

## Verification

- **Mechanical**: `pnpm typecheck`, `pnpm lint`, `pnpm test` in `apps/mobile` (main checkout).
- **Feel check** (real device):
  - Add a photo to "Agreement": during the pick the grid dims slightly (you can see something is happening), then the dashed tile is replaced by a filled tile that eases up from 96%, and the photo dissolves in rather than popping.
  - Remove it: the tile fades and neighbours glide, no snap.
  - Open the property screen with 5 documents already filled: nothing animates inside the grid (it only arrives with the screen).
  - Add two documents quickly: second animates independently, nothing restarts.
- **Reduced motion**: dim still happens; no scale, no glide; fade only.
- **Done when**: add, remove, busy, thumbnail transitions work; no animation on first load of a populated grid.
