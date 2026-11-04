/**
 * The voice screen's backdrop, the same as the rest of the app: the lavender
 * page fading to the card colour, closed by the shared FooterWaves. Decorative
 * only: hidden from screen readers and never takes a touch. Static, so there is
 * nothing to pause under reduced motion.
 */

import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@waves/ui';

import { FooterWaves } from '@/components/FooterWaves';

export function VoiceScene() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
    >
      <View style={[{ backgroundColor: theme.color.bg }, StyleSheet.absoluteFill]} />
      {/* Above the system navigation bar, which would otherwise cover them. */}
      <FooterWaves bottom={insets.bottom} />
    </View>
  );
}
