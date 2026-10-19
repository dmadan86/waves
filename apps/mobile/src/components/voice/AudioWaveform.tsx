/**
 * A small bar waveform of the last couple of seconds of REAL input loudness.
 *
 * The bars read a shared value the capture panel fills from the recogniser's
 * metering (or the stream's PCM level), thinned by `pushLevel` to one reading
 * per {@link LEVEL_MIN_GAP_MS}. Writing a shared value re-renders nothing: the
 * bars move on the UI thread. No clock drives them — silence is flat.
 */

import { View } from 'react-native';
import Reanimated, {
  useAnimatedStyle,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useTheme } from '@waves/ui';

import { LEVEL_BARS } from '@/lib/voiceFlowPure';

const BAR_W = 4;
const BAR_GAP = 3;
const MAX_H = 28;
const MIN_H = 4;

function Bar({
  levels,
  index,
  color,
}: {
  levels: SharedValue<readonly number[]>;
  index: number;
  color: string;
}) {
  const style = useAnimatedStyle(() => ({
    height: withTiming(MIN_H + (levels.value[index] ?? 0) * (MAX_H - MIN_H), { duration: 150 }),
  }));
  return (
    <Reanimated.View
      style={[{ width: BAR_W, borderRadius: BAR_W / 2, backgroundColor: color }, style]}
    />
  );
}

export function AudioWaveform({ levels }: { levels: SharedValue<readonly number[]> }) {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        height: MAX_H,
        flexDirection: 'row',
        alignItems: 'center',
        gap: BAR_GAP,
      }}
    >
      {Array.from({ length: LEVEL_BARS }, (_, index) => (
        <Bar key={index} levels={levels} index={index} color={theme.color.brand} />
      ))}
    </View>
  );
}

/** The waveform's box, reserved even when it is not drawn, so nothing jumps. */
export const WAVEFORM_HEIGHT = MAX_H;
