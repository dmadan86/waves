/**
 * Plays one of the assistant's entrances (see `assistantMotion`) on whatever it
 * wraps: the question card, the intro, the teaser, the saved bar's check.
 *
 * The motion is data and Reduce Motion is decided in one place: under it the
 * config is a 100 ms fade and nothing travels or scales. Runs on the UI thread
 * and mounts once; a changed `playKey` plays it again (the next question
 * cross-fading in).
 */

import { useEffect, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  cardCollapse,
  checkPop,
  questionEnter,
  questionSwap,
  type MotionConfig,
} from '@/lib/assistantMotion';
import { useReducedMotion } from '@/lib/reducedMotion';

export type AssistantEntrance = 'question' | 'swap' | 'check' | 'collapse';

export function entranceFor(kind: AssistantEntrance, reduceMotion: boolean): MotionConfig {
  switch (kind) {
    case 'swap':
      return questionSwap(reduceMotion);
    case 'check':
      return checkPop(reduceMotion);
    case 'collapse':
      return cardCollapse(reduceMotion);
    default:
      return questionEnter(reduceMotion);
  }
}

export function AssistantEnter({
  kind = 'question',
  playKey,
  style,
  children,
}: {
  kind?: AssistantEntrance;
  /** Changing this plays the entrance again. */
  playKey?: string | number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const motion = entranceFor(kind, reduceMotion);
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withTiming(1, {
      duration: motion.durationMs,
      easing: motion.easing === 'linear' ? Easing.linear : Easing.out(Easing.cubic),
    });
    // The config is derived from `kind` and the Reduce Motion setting; a replay is
    // asked for with `playKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playKey, kind, reduceMotion]);

  const animated = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [motion.opacity[0], motion.opacity[1]]),
    transform: [
      {
        translateY: interpolate(
          progress.value,
          [0, 1],
          [motion.translateY[0], motion.translateY[1]],
        ),
      },
      { scale: interpolate(progress.value, [0, 1], [motion.scale[0], motion.scale[1]]) },
    ],
  }));

  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}
