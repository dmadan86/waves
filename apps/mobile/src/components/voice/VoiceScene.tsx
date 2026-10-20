/**
 * The capture screen's backdrop: one full-bleed photograph under the status
 * bar. It is drawn at the screen's width and slid up so the sea and the terrace
 * table sit just above the sheet, the sky behind the title and the mic. A soft
 * wash at the top keeps the words readable over the leaves; in dark mode a
 * scrim does the same for the light text.
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
/** Where the terrace table sits in the photograph, as a share of its height. */
const TABLE = 0.78;

export function VoiceScene({ sheetTop }: { sheetTop: number }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const height = width * RATIO;
  // Never leave a gap above the photograph.
  const top = Math.min(0, sheetTop - height * TABLE);
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
        style={{ position: 'absolute', left: 0, top, width, height }}
      />
      <LinearGradient
        colors={
          dark
            ? ['rgba(0,0,0,0.6)', 'rgba(0,0,0,0.35)']
            : ['rgba(255,255,255,0.55)', 'rgba(255,255,255,0)']
        }
        locations={[0.25, 1]}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, height: sheetTop }}
      />
    </View>
  );
}
