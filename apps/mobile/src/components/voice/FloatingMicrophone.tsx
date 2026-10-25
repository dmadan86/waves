/**
 * The one control on the capture screen: an 80 dp purple circle.
 *
 *  - start   a mic glyph, a soft still glow. Tap to listen.
 *  - stop    a stop square. The glow ring swells with the REAL input level (the
 *            recogniser's metering or the stream's PCM level) — when nothing is
 *            metered it simply stays still; nothing is simulated.
 *  - busy    a small spinner in place of the glyph while the sentence is read or
 *            saved. Not tappable, so a second tap cannot submit twice.
 *  - retry   the mic glyph again after a miss or an error; the status line says why.
 *
 * Reduced motion keeps the ring at rest whatever the level.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, View } from 'react-native';
import Reanimated, {
  useAnimatedStyle,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useTheme } from '@waves/ui';

export const MIC_DIAMETER = 104;
/** The square the mic and its glow sit in, so the glow never moves the layout. */
export const MIC_BOX = 156;

export type MicMode = 'start' | 'stop' | 'busy' | 'retry';

export interface FloatingMicrophoneProps {
  mode: MicMode;
  /** Live input loudness, 0…1. Optional: the processing view has none. */
  level?: SharedValue<number> | null;
  onPress: () => void;
  /** Screen-reader label for what a tap does now. */
  label: string;
  reduceMotion: boolean;
}

function LevelRing({ level, color }: { level: SharedValue<number>; color: string }) {
  const style = useAnimatedStyle(() => ({
    opacity: withTiming(0.16 + level.value * 0.24, { duration: 150 }),
    transform: [{ scale: withTiming(1.12 + level.value * 0.3, { duration: 150 }) }],
  }));
  return (
    <Reanimated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: MIC_DIAMETER,
          height: MIC_DIAMETER,
          borderRadius: MIC_DIAMETER / 2,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

export function FloatingMicrophone({
  mode,
  level,
  onPress,
  label,
  reduceMotion,
}: FloatingMicrophoneProps) {
  const theme = useTheme();
  const brand = theme.color.brand;
  const busy = mode === 'busy';
  const live = mode === 'stop';
  return (
    <View
      style={{ width: MIC_BOX, height: MIC_BOX, alignItems: 'center', justifyContent: 'center' }}
    >
      {/* The still glow: a soft lavender halo that is there in every state, so
          the button reads as lifted off the page without anything moving. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: MIC_DIAMETER + 28,
          height: MIC_DIAMETER + 28,
          borderRadius: (MIC_DIAMETER + 28) / 2,
          backgroundColor: theme.color.brandSoft,
          opacity: theme.scheme === 'dark' ? 0.7 : 1,
        }}
      />
      {live && level && !reduceMotion ? <LevelRing level={level} color={brand} /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ busy, disabled: busy }}
        disabled={busy}
        onPress={onPress}
        hitSlop={8}
        style={({ pressed }) => ({
          width: MIC_DIAMETER,
          height: MIC_DIAMETER,
          borderRadius: MIC_DIAMETER / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? theme.color.brandPressed : brand,
          shadowColor: brand,
          shadowOpacity: live ? 0.42 : 0.28,
          shadowRadius: live ? 18 : 12,
          shadowOffset: { width: 0, height: 6 },
          elevation: live ? 10 : 6,
        })}
      >
        {busy ? (
          <ActivityIndicator color={theme.color.onBrand} />
        ) : (
          <Ionicons
            name={live ? 'stop' : 'mic'}
            size={live ? 28 : 34}
            color={theme.color.onBrand}
          />
        )}
      </Pressable>
    </View>
  );
}
