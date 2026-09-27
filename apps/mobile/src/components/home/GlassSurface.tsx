/**
 * A frosted glass card for the scenic heroes: the scene behind shows through as
 * atmosphere, blurred and mostly washed out, so it never competes with the
 * figures on it. Home's balance card and Personal's month tiles both stand on it.
 *
 * The shadow lives on the outer view and the clipping on the inner one — a
 * view that clips cannot also cast a shadow on iOS.
 */

import { type ReactNode, type RefObject } from 'react';
import { BlurView } from 'expo-blur';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@waves/ui';

export function GlassSurface({
  children,
  blurTarget,
  style,
}: {
  children: ReactNode;
  /** What the glass blurs on Android — the hero's scene, wrapped in a
   *  `BlurTargetView`. iOS blurs whatever is behind it without being told. */
  blurTarget?: RefObject<View | null>;
  /** Padding and layout for the contents. */
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  return (
    <View
      style={{
        borderRadius: theme.radius.xl,
        shadowColor: '#322864',
        shadowOpacity: 0.12,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 12 },
      }}
    >
      <View
        style={[
          {
            borderRadius: theme.radius.xl,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: dark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.65)',
          },
          style,
        ]}
      >
        <BlurView
          intensity={GLASS_BLUR}
          tint={dark ? 'dark' : 'light'}
          // Android draws a real blur only when asked; without it the card is
          // simply translucent, which the fill below already keeps readable.
          experimentalBlurMethod="dimezisBlurView"
          blurTarget={blurTarget}
          style={StyleSheet.absoluteFill}
        />
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: dark ? 'rgba(28, 26, 44, 0.82)' : 'rgba(255, 255, 255, 0.82)' },
          ]}
        />
        {children}
      </View>
    </View>
  );
}

/** How hard the glass blurs what is behind it. */
const GLASS_BLUR = 40;
