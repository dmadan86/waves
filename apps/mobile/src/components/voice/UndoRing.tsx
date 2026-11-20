/** The 6 s countdown ring on Undo: full at the start, drained at the end. Static under Reduce Motion. */

import { useEffect, useState } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useTheme } from '@waves/ui';

import { UNDO_RING_MS, UNDO_RING_SIZE } from '@/lib/assistantMotion';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const STROKE = 2;
const RADIUS = (UNDO_RING_SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function UndoRing({ animated }: { animated: boolean }) {
  const theme = useTheme();
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!animated) return undefined;
    const run = Animated.timing(progress, {
      toValue: 1,
      duration: UNDO_RING_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    });
    run.start();
    return () => run.stop();
  }, [animated, progress]);
  return (
    <Svg width={UNDO_RING_SIZE} height={UNDO_RING_SIZE} accessibilityElementsHidden>
      <AnimatedCircle
        cx={UNDO_RING_SIZE / 2}
        cy={UNDO_RING_SIZE / 2}
        r={RADIUS}
        stroke={theme.color.brand}
        strokeWidth={STROKE}
        fill="none"
        strokeDasharray={`${CIRCUMFERENCE}`}
        strokeDashoffset={progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, CIRCUMFERENCE],
        })}
        strokeLinecap="round"
      />
    </Svg>
  );
}
