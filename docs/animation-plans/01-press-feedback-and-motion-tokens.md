# 01 - Add motion tokens and give cards, tiles and buttons a press dip

- **Status**: TODO (proposed, awaiting owner approval)
- **Commit**: 781ec67fe
- **Severity**: HIGH
- **Category**: Missed opportunities (feedback) and Cohesion and tokens
- **Estimated scope**: 1 token file edit, 6 screen/component edits, about 80 changed lines. Every other plan depends on this one.

## Problem

Cards and tiles in Rentals and Personal give no press feedback, or only an opacity blink. The app already has `PressableScale` (a spring dip under the finger) but it is used in just 3 places. The app also has no shared easing or spring tokens, so each plan below would hand-type curves. This plan adds the tokens and applies the press dip.

Current code, verbatim.

```tsx
// apps/mobile/src/app/rentals/index.tsx:222 - property card, no feedback at all
<Pressable
  key={p.id}
  accessibilityRole="button"
  accessibilityLabel={p.name}
  onPress={() => router.push({ pathname: '/rentals/[id]', params: { id: p.id, ...spaceParams(space) } })}
>
  <StandardCard style={{ gap: theme.spacing.md }}>
```

```tsx
// apps/mobile/src/app/rentals/[id].tsx:88 - TintButton (Add expense / Receipts), no feedback
<Pressable
  accessibilityRole="button"
  ...
  style={{ flex: 1, minHeight: 48, flexDirection: 'row', ... opacity: disabled ? 0.5 : 1 }}
>
```

```tsx
// apps/mobile/src/components/personal/PersonalHomeParts.tsx:260 (QuickActions) and :320 (MoneyToolsRow)
style={({ pressed }) => ({ ... opacity: pressed ? 0.7 : 1 })}
```

```tsx
// apps/mobile/src/lib/anim.tsx:67-95 - existing kit
export const TRANSITION_MS = 260;
const PRESS_SPRING = { damping: 18, stiffness: 280, mass: 0.5 } as const;
...
entering={reduceMotion ? undefined : FadeInDown.duration(340).delay(staggerDelay(index))}
...
onPressIn={(event) => { if (!reduceMotion) scale.set(withSpring(0.96, PRESS_SPRING)); onPressIn?.(event); }}
```

## Target

Tokens, all exported from `apps/mobile/src/lib/anim.tsx` (extend, do not create a parallel file).

```ts
import { Easing } from 'react-native-reanimated'; // add to the existing import list

/** Strong ease-out for entrances and anything answering a touch. */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
/** Strong ease-in-out for things moving on screen (progress, sliding highlight). */
export const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);
/** Default settle for anything the user can touch: critically damped, no overshoot. */
export const SPRING_SETTLE = { duration: 350, dampingRatio: 1 } as const;
/** A small, rare pop (money arrived, a choice made). Slight overshoot, never used on frequent controls. */
export const SPRING_POP = { duration: 400, dampingRatio: 0.7 } as const;
```

`withSpring(x, SPRING_SETTLE)` is valid in Reanimated 4 (`AppTabBar.tsx:236` already uses `{ duration: 300, dampingRatio: 0.8 }`). `Easing.bezier(...)` is accepted directly by `withTiming({ easing })` and by layout-animation builders `.easing(EASE_OUT)`.

`PressableScale` gets one optional prop and keeps `PRESS_SPRING`.

```tsx
export function PressableScale({ children, style, pressedScale = 0.96, onPressIn, onPressOut, ...rest }:
  Omit<PressableProps, 'style'> & { children: ReactNode; style?: ViewStyle; pressedScale?: number }) {
  ...
  if (!reduceMotion) scale.set(withSpring(pressedScale, PRESS_SPRING));
```

Values per surface:

| Surface                                                       | `pressedScale` |
| ------------------------------------------------------------- | -------------- |
| Property card (`rentals/index.tsx:222`), doc tiles            | 0.98           |
| `TintButton`, `Pick` tile, QuickActions tile, MoneyTools tile | 0.96 (default) |

Press-in stays under 100ms to start moving (spring, `mass 0.5`), release is the same spring (the existing asymmetric-free house choice). Reduced motion: no scale (existing behaviour); keep the colour/opacity change where one already exists.

## Repo conventions to follow

- Exemplar: `apps/mobile/src/components/ScreenHero.tsx:438` and `friends.tsx:1542` use `<PressableScale>` in place of `<Pressable>`.
- Reanimated shared values use `.get()` / `.set()` (not `.value`) inside handlers, as `anim.tsx` does.
- Stagger fix: `FadeInDown.duration(260).easing(EASE_OUT).delay(staggerDelay(index))`. Do not change `staggerDelay` or its test.
- Types: `PressableScale` takes a static `style?: ViewStyle`, not a function. When converting a `style={({ pressed }) => ...}` call site, drop the `pressed` branch and pass the static object.

## Steps

1. `apps/mobile/src/lib/anim.tsx`:
   a. Add `Easing` to the `react-native-reanimated` import, add the four exported tokens above (below `TRANSITION_MS`).
   b. In `Stagger`, change `FadeInDown.duration(340).delay(...)` to `FadeInDown.duration(260).easing(EASE_OUT).delay(staggerDelay(index))`.
   c. Add `pressedScale = 0.96` prop to `PressableScale` and use it in `onPressIn`.
   d. Fix the file's header comment: replace "The animations always play: there is no preference gating them off." with "Animations are skipped when the OS asks for reduced motion (`useReducedMotion`)."
2. `apps/mobile/src/app/rentals/index.tsx:222`: replace `Pressable` with `PressableScale` (`pressedScale={0.98}`). Add `import { PressableScale } from '@/lib/anim';` and remove `Pressable` from the `react-native` import only if no other use remains (the header "Add" `Pressable` at line 155 still uses it, so keep it).
3. `apps/mobile/src/app/rentals/[id].tsx:88` (`TintButton`): replace `Pressable` with `PressableScale`. Keep `disabled`, `opacity`, `accessibility*` props exactly. When `disabled`, `PressableScale` still receives `disabled` via `...rest`, so no dip occurs.
4. `apps/mobile/src/components/wealth/parts.tsx:200` (`Pick` tile `Pressable` inside `options.map`): replace with `PressableScale`. The `style={{ flexBasis: '47%', flexGrow: 1 }}` is already a static object.
5. `apps/mobile/src/components/personal/PersonalHomeParts.tsx:260` and `:320`: replace each `Pressable` with `PressableScale`; move the static part of the style object, delete `opacity: pressed ? 0.7 : 1`. Keep `ref={tile.ref}` on QuickActions (see verification: the tour spotlight measures it).
6. `apps/mobile/src/components/wealth/RentalExtras.tsx:446` (`emptyTile`) and `:494` (filled slot tile outer `Pressable`): replace with `PressableScale` (`pressedScale={0.98}`). Leave the inner 28px menu button (`:538`) as a plain `Pressable`; nested press targets must not both scale.
7. Do NOT touch `packages/ui` (see Boundaries).

## Boundaries

- Do NOT edit anything under `packages/ui` (Button, Chip, Sheet). That is a separate app-wide decision.
- Do NOT add entrance animations here (plans 02 to 04).
- Do NOT touch `GroupRow.tsx`, `SwipeRow.tsx`, `AppTabBar.tsx`.
- No new dependencies. Reanimated only, from `react-native-reanimated`.
- If a line number does not match the excerpt, STOP and report.

## Verification

- **Mechanical** (run in `apps/mobile` from the main checkout, not a worktree with symlinked `node_modules`): `pnpm typecheck`, `pnpm lint`, `pnpm test` (the `motionMath` tests must still pass; nothing in `motionMath.ts` changed).
- **Feel check** on a real phone (scrolling and gestures cannot be judged in a simulator):
  - Tap and hold a property card: it dips to about 98% right away and springs back on release with no wobble. Slide the finger off the card: it returns, no stuck state.
  - Hold "Add expense" on a property: dips 4%. A disabled "Receipts" button does not dip.
  - Press a Personal quick tile: dips, then navigates; the tour spotlight (onboarding tour) still highlights the tile correctly because `ref` still resolves.
  - Spam-tap a tile 10 times: it never ends up scaled down (spring retargets).
  - Slow it down: with Developer options "Window animation scale" at 10x, the dip is visible as one smooth motion, no two-step.
- **Reduced motion**: turn on Remove animations (Android) or Reduce Motion (iOS). Cards do not scale at all; taps and navigation still work.
- **Done when**: tokens exist and typecheck, the six surfaces dip on press, no `opacity: pressed ? 0.7` remains in `PersonalHomeParts.tsx` for these two tile types, tests and lint are green.
