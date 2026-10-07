/**
 * The mascot between its two waveforms, over a soft scene — the picture the
 * advanced voice confirmation sits under. Its edges are feathered to nothing,
 * so it reads as part of the page rather than a picture pasted onto it.
 *
 * Decorative only: hidden from screen readers, never takes a touch. The audio
 * has finished by the time this is on screen, so the waveforms are still.
 */

import { Image } from 'expo-image';
import { View } from 'react-native';

import { useTheme } from '@waves/ui';

const ART = require('../../assets/images/voice-mascot-art.webp') as number;

/** The picture's width over its height (550 × 234). */
const RATIO = 550 / 234;

export function VoiceMascotArt({ height = 104 }: { height?: number }) {
  const theme = useTheme();
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ alignItems: 'center', opacity: theme.scheme === 'dark' ? 0.8 : 1 }}
    >
      <Image
        source={ART}
        contentFit="contain"
        style={{ width: Math.round(height * RATIO), height }}
      />
    </View>
  );
}
