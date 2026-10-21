/**
 * The voice screen's backdrop, the same as the rest of the app: the lavender
 * page fading to the card colour, closed by the shared FooterWaves. Decorative
 * only: hidden from screen readers and never takes a touch. Static, so there is
 * nothing to pause under reduced motion.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@waves/ui';

import { FooterWaves } from '@/components/FooterWaves';

export function VoiceScene() {
  const theme = useTheme();
  // Dark mode stays flat: a lighter lower half would glare.
  const end = theme.scheme === 'dark' ? theme.color.bg : theme.color.surface;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
    >
      <LinearGradient colors={[theme.color.bg, end]} style={StyleSheet.absoluteFill} />
      <FooterWaves bottom={0} />
    </View>
  );
}
