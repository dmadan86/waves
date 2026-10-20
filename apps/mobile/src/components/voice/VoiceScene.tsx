/**
 * The capture screen's backdrop: one full-bleed photograph, edge to edge and
 * under the status bar. The bottom sheet covers its lower part, so only the
 * sky, sea and terrace above the sheet are ever seen. In dark mode a scrim
 * keeps the light text on top readable.
 *
 * Decorative only: hidden from screen readers and never takes a touch.
 */

import { Image, StyleSheet, View } from 'react-native';

import { useTheme } from '@waves/ui';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const SCENE = require('../../../assets/images/voice-scene.webp') as number;

export function VoiceScene() {
  const theme = useTheme();
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
    >
      <Image source={SCENE} resizeMode="cover" fadeDuration={0} style={StyleSheet.absoluteFill} />
      {theme.scheme === 'dark' ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]} />
      ) : null}
    </View>
  );
}
