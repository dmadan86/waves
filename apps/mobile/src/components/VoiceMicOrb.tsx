/**
 * The voice screen's mic: a brand disc inside two soft halos, with a thin
 * track ring around it. While `working`, a quarter of that ring is lit and
 * turns — the "I'm on it" between speaking and seeing the result.
 *
 * Decorative: hidden from screen readers (the words beside it carry the
 * state) and never takes a touch.
 */

import { useEffect } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { useTheme } from '@waves/ui';

/** One turn of the lit arc. */
const TURN_MS = 1100;

export function VoiceMicOrb({ size = 220, working = false }: { size?: number; working?: boolean }) {
  const theme = useTheme();
  const brand = theme.color.brand;

  // Proportions read off the design: halo, ring, inner halo, disc.
  const ring = size * 0.82;
  const inner = size * 0.55;
  const disc = size * 0.41;
  const stroke = Math.max(2, size * 0.022);
  const radius = (ring - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  const turn = useSharedValue(0);
  useEffect(() => {
    if (!working) {
      cancelAnimation(turn);
      turn.value = 0;
      return;
    }
    turn.value = withRepeat(
      withTiming(360, { duration: TURN_MS, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(turn);
  }, [working, turn]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));

  const centred = { position: 'absolute', alignItems: 'center', justifyContent: 'center' } as const;

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      <View
        style={{
          ...centred,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: theme.color.brandSoft,
          opacity: 0.45,
        }}
      />
      <Svg width={ring} height={ring} style={{ position: 'absolute' }}>
        <Circle
          cx={ring / 2}
          cy={ring / 2}
          r={radius}
          stroke={theme.color.brandSoft}
          strokeWidth={stroke}
          fill={theme.color.bg}
        />
      </Svg>
      {working ? (
        <Animated.View style={[{ position: 'absolute', width: ring, height: ring }, spin]}>
          <Svg width={ring} height={ring}>
            <Circle
              cx={ring / 2}
              cy={ring / 2}
              r={radius}
              stroke={brand}
              strokeWidth={stroke}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${circumference * 0.22} ${circumference}`}
              // Start at twelve o'clock rather than three.
              transform={`rotate(-90 ${ring / 2} ${ring / 2})`}
            />
          </Svg>
        </Animated.View>
      ) : null}
      <View
        style={{
          ...centred,
          width: inner,
          height: inner,
          borderRadius: inner / 2,
          backgroundColor: theme.color.brandSoft,
        }}
      />
      <View
        style={{
          backgroundColor: brand,
          width: disc,
          height: disc,
          borderRadius: disc / 2,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: brand,
          shadowOpacity: 0.35,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 6 },
          elevation: 8,
        }}
      >
        <Ionicons name="mic-outline" size={disc * 0.44} color={theme.color.onBrand} />
      </View>
    </View>
  );
}
