/**
 * The cards under the voice stage (preview, question, saved) arrive in place:
 * a short fade and rise whenever `id` changes, so the stage above never moves
 * and the new content does not pop. The children are never remounted. Under
 * reduced motion it is a plain View.
 */

import { useEffect, type ReactNode } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';

export const APPEAR_MS = 250;
const RISE = 12;

export function StageAppear({
  id,
  reduceMotion,
  onLayout,
  children,
}: {
  id: string;
  reduceMotion: boolean;
  onLayout?: (event: LayoutChangeEvent) => void;
  children: ReactNode;
}) {
  const progress = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) {
      progress.set(1);
      return;
    }
    progress.set(0);
    progress.set(withTiming(1, { duration: APPEAR_MS, easing: Easing.out(Easing.cubic) }));
  }, [id, progress, reduceMotion]);
  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * RISE }],
  }));
  if (reduceMotion) return <View onLayout={onLayout}>{children}</View>;
  return (
    <Reanimated.View onLayout={onLayout} style={style}>
      {children}
    </Reanimated.View>
  );
}
