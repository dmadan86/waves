/**
 * The app's motion, in one place.
 *
 * Motion is a response, not a scene: entrances are short, the count keeps to
 * well under a second, and a press answers under the finger. Animations are
 * skipped when the OS asks for reduced motion (`useReducedMotion`).
 *
 * The pure maths lives at the bottom, exported, because a count that lands on
 * the wrong number or a stagger that never stops is a bug you want to catch in
 * a test rather than by watching the screen.
 */

import { useEffect, useRef, type ReactNode, type Ref } from 'react';

import { isRtlLayout } from '@waves/ui';
import { Pressable, type PressableProps, type View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type EntryExitAnimationFunction,
} from 'react-native-reanimated';

import { useReducedMotion } from './reducedMotion';
import { segmentWidth, segmentX, staggerDelay } from './motionMath';

export { easeOutCubic, lerpBig, MAX_SAFE_MINOR, staggerDelay } from './motionMath';

/**
 * A short opacity crossfade between a skeleton value and the real one it
 * stands in for — both stay mounted across the swap, which is what lets the
 * dissolve happen in place instead of the layout jumping as one unmounts and
 * the other takes its spot. The same device `ScreenHero`'s `useHeroCrossfade`
 * uses for its title/selection swap, generalised to a plain before/after pair
 * with no translate, since a figure or a bar settling into its final value
 * has nowhere to travel from. Off entirely under reduced motion, where the
 * swap is a hard cut rather than a dissolve.
 */
export function useCrossfade(active: boolean, duration = 180) {
  const reduceMotion = useReducedMotion();
  const sel = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    sel.set(reduceMotion ? (active ? 1 : 0) : withTiming(active ? 1 : 0, { duration }));
  }, [active, reduceMotion, sel, duration]);
  const fromStyle = useAnimatedStyle(() => ({ opacity: 1 - sel.get() }));
  const toStyle = useAnimatedStyle(() => ({ opacity: sel.get() }));
  return { fromStyle, toStyle };
}

/** How long a screen transition runs. Short enough to feel like a response,
    not a scene — used by the navigator's `animationDuration`. */
export const TRANSITION_MS = 260;

/** Strong ease-out for entrances and anything answering a touch. */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
/** Strong ease-in-out for things moving on screen (progress, sliding highlight). */
export const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);
/** Default settle for anything the user can touch: critically damped, no overshoot. */
export const SPRING_SETTLE = { duration: 350, dampingRatio: 1 } as const;
/** A small, rare pop (money arrived, a choice made). Slight overshoot, never on frequent controls. */
export const SPRING_POP = { duration: 400, dampingRatio: 0.7 } as const;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** The spring a press answers with: quick, barely overshooting, back to rest. */
const PRESS_SPRING = { damping: 18, stiffness: 280, mass: 0.5 } as const;

/**
 * A list item that arrives rather than appears.
 *
 * Each card fades up a beat after the one above it (`staggerDelay`), which is
 * what makes a list read as one thing settling into place instead of a block
 * that blinks on. The delay is capped, so a long list finishes rather than
 * dribbling in for a second and a half.
 *
 * The entrance plays once, when the row mounts — a data refetch that keeps the
 * same keys does not remount, so the list does not re-stagger every pull.
 */
export function Stagger({ index = 0, children }: { index?: number; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  return (
    <Animated.View
      entering={
        reduceMotion
          ? undefined
          : FadeInDown.duration(260).easing(EASE_OUT).delay(staggerDelay(index))
      }
    >
      {children}
    </Animated.View>
  );
}

/**
 * A pressable that dips under the finger.
 *
 * Replaces the flat opacity blink with a spring scale, which is the difference
 * between a card that registers a tap and one that feels like a button.
 */
export function PressableScale({
  children,
  style,
  pressedScale = 0.96,
  onPressIn,
  onPressOut,
  ...rest
}: Omit<PressableProps, 'style'> & {
  children: ReactNode;
  style?: ViewStyle;
  pressedScale?: number;
  ref?: Ref<View>;
}) {
  const reduceMotion = useReducedMotion();
  // `.get()`/`.set()` rather than `.value`: the same shared value, through the
  // method API Reanimated 4 added — a call, not an assignment to a property the
  // React compiler treats as immutable and refuses inside a handler.
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  return (
    <AnimatedPressable
      style={[animatedStyle, style]}
      onPressIn={(event) => {
        if (!reduceMotion) scale.set(withSpring(pressedScale, PRESS_SPRING));
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        if (!reduceMotion) scale.set(withSpring(1, PRESS_SPRING));
        onPressOut?.(event);
      }}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
}

/**
 * The detail screen a card opens onto, arriving as if it grew from the tap.
 *
 * Reanimated 4 dropped the shared-element transition tag, so this is not a
 * literal morph of the card into the screen — it is the screen's own content
 * springing up from just under full size while it fades in, which reads as an
 * opening rather than a slide. Paired with `PressableScale` on the card that
 * launched it, the tap and the arrival belong to each other.
 */
export function DetailEnter({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const reduceMotion = useReducedMotion();
  return (
    <Animated.View
      style={[{ flex: 1 }, style]}
      entering={reduceMotion ? undefined : detailEntering}
    >
      {children}
    </Animated.View>
  );
}

/**
 * The open, as a declarative entrance rather than a mount effect: content starts
 * a shade under full size and transparent, then springs up and fades in. Written
 * this way — a worklet Reanimated runs on the UI thread — so nothing here mutates
 * a value from an effect, which the screen never needed and the linter rightly
 * refuses.
 */
const detailEntering: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.97 }] },
    animations: {
      opacity: withTiming(1, { duration: 220 }),
      transform: [{ scale: withSpring(1, { damping: 20, stiffness: 200 }) }],
    },
  };
};

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

/** A picture that rises 12px into place while fading in (first-run empty states). */
export const houseEntering: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 12 }] },
    animations: {
      opacity: withTiming(1, { duration: 200 }),
      transform: [{ translateY: withSpring(0, SPRING_SETTLE) }],
    },
  };
};

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

/**
 * The selected-segment highlight: one pill that slides between equal segments
 * instead of the background swapping. Calm and critically damped (it sits on a
 * control used tens of times a day); the first measured frame does not animate.
 */
export function SlidingHighlight({
  index,
  count,
  width,
  color,
  radius,
  height,
  inset = 0,
  gap = 0,
}: {
  index: number;
  count: number;
  width: number;
  color: string;
  radius: number;
  height: number;
  inset?: number;
  gap?: number;
}) {
  const reduce = useReducedMotion();
  const seg = segmentWidth(count, width, inset, gap);
  // translateX does not mirror in RTL while `start: 0` does, so mirror the offset.
  const x = segmentX(index, count, width, inset, gap) * (isRtlLayout() ? -1 : 1);
  const tx = useSharedValue(x);
  const placed = useRef(false);
  useEffect(() => {
    tx.set(reduce || !placed.current ? x : withSpring(x, SPRING_SETTLE));
    if (width > 0) placed.current = true;
  }, [x, width, reduce, tx]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: tx.get() }] }));
  if (width === 0) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', top: inset, start: 0, width: seg, height, borderRadius: radius },
        { backgroundColor: color },
        style,
      ]}
    />
  );
}
