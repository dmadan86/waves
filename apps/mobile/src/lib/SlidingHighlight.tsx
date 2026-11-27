/** The sliding segment highlight, kept apart from `anim` so that file stays free of `@waves/ui`. */

import { useEffect, useRef } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { isRtlLayout } from '@waves/ui';

import { SPRING_SETTLE } from './anim';
import { segmentWidth, segmentX } from './motionMath';
import { useReducedMotion } from './reducedMotion';

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
