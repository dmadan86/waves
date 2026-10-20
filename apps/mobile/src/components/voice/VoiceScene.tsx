/**
 * The capture screen's backdrop: one full-bleed photograph behind everything,
 * drawn at the screen's width and anchored to the bottom, so the terrace table
 * and the sea sit at the foot of the screen and the sky and leaves above. A
 * light wash from the top keeps the words readable and fades out by mid-screen;
 * in dark mode a scrim does the same for the light text.
 *
 * Decorative only: hidden from screen readers and never takes a touch.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { Image, StyleSheet, useWindowDimensions, View } from 'react-native';

import { useTheme } from '@waves/ui';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const SCENE = require('../../../assets/images/voice-scene.webp') as number;
/** The photograph is 849 × 1852. */
const RATIO = 1852 / 849;

export function VoiceScene() {
  const theme = useTheme();
  const { width, height: screen } = useWindowDimensions();
  // Fill the screen on a short phone too: scale up and keep the bottom anchored.
  const height = Math.max(width * RATIO, screen);
  const imageWidth = height / RATIO;
  const dark = theme.scheme === 'dark';
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}
    >
      <Image
        source={SCENE}
        resizeMode="cover"
        fadeDuration={0}
        style={{
          position: 'absolute',
          left: (width - imageWidth) / 2,
          top: screen - height,
          width: imageWidth,
          height,
        }}
      />
      <LinearGradient
        colors={
          dark
            ? ['rgba(0,0,0,0.6)', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.1)']
            : ['rgba(255,255,255,0.6)', 'rgba(255,255,255,0.25)', 'rgba(255,255,255,0)']
        }
        locations={[0, 0.5, 1]}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, height: screen * 0.55 }}
      />
    </View>
  );
}
