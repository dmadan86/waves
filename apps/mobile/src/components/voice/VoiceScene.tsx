/**
 * The voice screen's backdrop, the same as the rest of the app: the plain
 * page colour. Decorative only: hidden from screen readers and never takes a touch. Static, so there is
 * nothing to pause under reduced motion.
 */

import { StyleSheet, View } from 'react-native';

import { useTheme } from '@waves/ui';

export function VoiceScene() {
  const theme = useTheme();
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
    >
      <View style={[{ backgroundColor: theme.color.bg }, StyleSheet.absoluteFill]} />
    </View>
  );
}
