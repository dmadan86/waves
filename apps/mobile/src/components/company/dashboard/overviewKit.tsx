/** Small pieces the Overview sections share: a tinted card and a skeleton box. */

import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';

import { useTheme } from '@waves/ui';

/** `#RRGGBB` plus an alpha 0..1, so one ink colour tints a card in light and dark alike. */
export function withAlpha(hex: string, alpha: number): string {
  return `${hex.slice(0, 7)}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')}`;
}

export const AMBER = '#D97706';
export const RED = '#DC2626';

export function TintCard({
  ink,
  children,
  style,
}: {
  ink: string;
  children: ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View
      style={[
        {
          borderRadius: 18,
          padding: 12,
          backgroundColor: withAlpha(ink, 0.09),
          borderWidth: 1,
          borderColor: withAlpha(ink, 0.14),
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function IconDisc({
  ink,
  size = 34,
  children,
}: {
  ink: string;
  size?: number;
  children: ReactNode;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: withAlpha(ink, 0.16),
      }}
    >
      {children}
    </View>
  );
}

/** A grey placeholder block: skeletons stand in for numbers that have not loaded, never a flash of zeros. */
export function Skeleton({
  height,
  flex,
  style,
}: {
  height: number;
  flex?: number;
  style?: ViewStyle;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      style={[{ height, flex, borderRadius: 18, backgroundColor: theme.color.surfaceMuted }, style]}
    />
  );
}
