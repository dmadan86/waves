import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';

import { useTheme } from '../theme';

export interface GradientProps {
  children?: ReactNode;
  /** Corner radius; 0 is kept, anything capsule-sized (20+) becomes the control radius. */
  radius?: number;
  /** Kept for callers; only the first stop is painted (the calm system has no washes). */
  colors?: readonly string[];
  style?: ViewStyle;
}

/**
 * A flat brand fill. The name is historical: the calm design system draws no
 * gradients, so this paints the first stop (brand by default) as a solid.
 */
export function Gradient({ children, radius, colors, style }: GradientProps) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: colors?.[0] ?? theme.color.brand,
          borderRadius: radius === undefined || radius >= 20 ? theme.radius.md : radius,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
