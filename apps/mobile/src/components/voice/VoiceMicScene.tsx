import type { ReactNode } from 'react';
import { useEffect } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';
import Reanimated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useTheme } from '@waves/ui';

function SoundBar({
  index,
  live,
  reduceMotion,
  level,
}: {
  index: number;
  live: boolean;
  reduceMotion: boolean;
  level?: SharedValue<number> | null;
}) {
  const theme = useTheme();
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (!reduceMotion)
      pulse.value = withRepeat(
        withTiming(1, { duration: live ? 360 + index * 90 : 1800 }),
        -1,
        true,
      );
    else {
      cancelAnimation(pulse);
      pulse.value = 0;
    }
    return () => cancelAnimation(pulse);
  }, [live, reduceMotion, index, pulse]);
  const style = useAnimatedStyle(() => ({
    transform: [
      {
        scaleY: reduceMotion
          ? 1
          : live
            ? 0.5 + pulse.value * 0.5 + (level?.value ?? 0) * 0.7
            : 0.8 + pulse.value * 0.2,
      },
    ],
    opacity: live ? 0.7 : 0.25,
  }));
  return (
    <Reanimated.View
      style={[
        {
          width: 4,
          height: [14, 25, 36, 20][index],
          borderRadius: 3,
          backgroundColor: theme.color.brand,
        },
        style,
      ]}
    />
  );
}

const BUBBLES = [
  { icon: 'receipt-outline', tint: 'lavender', left: '5%', top: 8, rotate: '-15deg' },
  { icon: 'cart-outline', tint: 'peach', left: '1%', top: 100, rotate: '-12deg' },
  { icon: 'cafe-outline', tint: 'peach', right: '8%', top: 2, rotate: '9deg' },
  { icon: 'car-outline', tint: 'sky', right: '0%', top: 64, rotate: '12deg' },
  { icon: 'home-outline', tint: 'mint', right: '5%', top: 123, rotate: '12deg' },
] as const;

/** Decorative icons and bars never intercept the central microphone's touches. */
export function VoiceMicScene({
  children,
  live,
  reduceMotion,
  level,
  compact,
}: {
  children: ReactNode;
  live: boolean;
  reduceMotion: boolean;
  level?: SharedValue<number> | null;
  compact: boolean;
}) {
  const theme = useTheme();
  const breath = useSharedValue(0);
  useEffect(() => {
    if (!reduceMotion && !live)
      breath.value = withRepeat(withTiming(1, { duration: 1800 }), -1, true);
    else {
      cancelAnimation(breath);
      breath.value = 0;
    }
    return () => cancelAnimation(breath);
  }, [breath, reduceMotion, live]);
  const haloStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + breath.value * 0.04 }] }));
  return (
    <View
      style={{
        alignSelf: 'stretch',
        height: compact ? 154 : 190,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Reanimated.View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          {
            position: 'absolute',
            width: 176,
            height: 176,
            borderRadius: 88,
            backgroundColor: theme.color.brandSoft,
            opacity: 0.5,
          },
          haloStyle,
        ]}
      />
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ position: 'absolute', inset: 0 }}
      >
        {BUBBLES.map(({ icon, tint, rotate, ...position }) => {
          const color =
            tint === 'lavender'
              ? { bg: theme.color.brandSoft, ink: theme.color.brand }
              : theme.tint[tint];
          return (
            <View
              key={icon}
              style={{
                position: 'absolute',
                ...position,
                top: compact ? position.top * 0.8 : position.top,
                width: compact ? 38 : 44,
                height: compact ? 38 : 44,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 15,
                backgroundColor: color.bg,
                transform: [{ rotate }],
              }}
            >
              <Ionicons name={icon} size={25} color={color.ink} />
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}
        >
          {[0, 1, 2, 3].map((index) => (
            <SoundBar
              key={index}
              index={index}
              live={live}
              reduceMotion={reduceMotion}
              level={level}
            />
          ))}
        </View>
        {children}
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}
        >
          {[3, 2, 1, 0].map((index) => (
            <SoundBar
              key={index}
              index={index}
              live={live}
              reduceMotion={reduceMotion}
              level={level}
            />
          ))}
        </View>
      </View>
    </View>
  );
}
