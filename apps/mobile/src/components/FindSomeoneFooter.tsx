/**
 * The terrace along the foot of Find someone: plants, books and a Waves mug
 * with hazy hills behind. It sits under everything on the screen at the
 * picture's own shape (never stretched), and its top fades into the page so it
 * reads as the place the search happens rather than a picture pasted at the
 * bottom. In dark mode the daylight scene is dimmed so it does not glare.
 *
 * Decorative only: hidden from screen readers and never takes a touch.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { Image, StyleSheet, useWindowDimensions, View } from 'react-native';

import { useTheme } from '@waves/ui';

const FOOTER_SCENE = require('../../assets/images/find-someone-footer.webp') as number;

/** The picture's width over its height (849 × 448). */
const RATIO = 849 / 448;

export function FindSomeoneFooter() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const natural = width / RATIO;
  // On a wide tablet the picture is cropped from its sky, never stretched.
  const height = Math.min(natural, 320);
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
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: natural,
          width,
          opacity: theme.scheme === 'dark' ? 0.4 : 1,
        }}
      />
      <LinearGradient
        colors={[theme.color.bg, `${theme.color.bg}00`]}
        locations={[0, 0.5]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
