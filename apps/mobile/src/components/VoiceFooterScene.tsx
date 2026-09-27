/**
 * The quiet scene along the foot of Speak an expense: a sunlit desk — a plant,
 * a cup, a notebook — with the city soft behind it. It sits under everything on
 * the screen, full width at the picture's own shape (never stretched), and its
 * top fades into the page so it reads as the room the mic is in rather than a
 * picture pasted at the bottom.
 *
 * Decorative only: hidden from screen readers and never takes a touch.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { Image, StyleSheet, useWindowDimensions, View } from 'react-native';

import { useTheme } from '@waves/ui';

const FOOTER_SCENE = require('../../assets/images/voice-footer.webp') as number;

/** The picture's width over its height (1536 × 674). */
const RATIO = 1536 / 674;

export function VoiceFooterScene() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  // Full width at its own shape, but never taller than a third of a tall
  // screen — on a wide iPad the picture is cropped from the top (its sky)
  // instead of climbing up behind the mic.
  const natural = width / RATIO;
  const height = Math.min(natural, 360);
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height, overflow: 'hidden' }}
    >
      <Image
        source={FOOTER_SCENE}
        resizeMode="cover"
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: natural, width }}
      />
      {/* The top of the picture runs into the page, so there is no edge. */}
      <LinearGradient
        colors={[theme.color.bg, `${theme.color.bg}00`]}
        locations={[0, 0.45]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
