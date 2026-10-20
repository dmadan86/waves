/**
 * The capture screen's backdrop: one full-bleed photograph behind everything,
 * scaled so the sea's horizon sits low (about 70% down) with the sky and
 * leaves filling the top, and only the edge of the terrace table at the foot. A
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
/** Where the far shore meets the sea in the photograph, and where it goes on screen. */
const HORIZON = 0.6;
const HORIZON_ON_SCREEN = 0.72;

export function VoiceScene() {
  const theme = useTheme();
  const { width, height: screen } = useWindowDimensions();
  // Tall enough that the horizon lands low with the photograph's top at the
  // screen's top; never narrower than the screen. The sides crop evenly.
  const height = Math.max(width * RATIO, (screen * HORIZON_ON_SCREEN) / HORIZON);
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
          top: 0,
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
