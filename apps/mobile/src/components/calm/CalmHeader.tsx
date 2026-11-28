/** A calm screen's head: the date line, one big title, and round-less icons at the end. */

import type { ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { iconSize, Row, Text, useTheme } from '@waves/ui';

import { useHeroStatusBar } from '@/components/ScreenHero';

export function CalmHeader({
  dateLine,
  title,
  children,
  topInset = true,
}: {
  dateLine: string;
  title: string;
  children?: ReactNode;
  /** False when a navigator header already clears the status bar. */
  topInset?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  useHeroStatusBar(theme.scheme === 'dark' ? 'light' : 'dark');
  return (
    <Row
      style={{
        alignItems: 'flex-end',
        gap: theme.spacing.sm,
        paddingTop: (topInset ? insets.top : 0) + theme.spacing.xs,
        paddingBottom: theme.spacing.xs,
        paddingHorizontal: theme.spacing.lg,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {dateLine}
        </Text>
        <Text accessibilityRole="header" variant="title" style={{ fontWeight: '700' }}>
          {title}
        </Text>
      </View>
      {children}
    </Row>
  );
}

export function CalmIconButton({
  icon,
  label,
  onPress,
  dot = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  dot?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.5 : 1,
      })}
    >
      <Ionicons name={icon} size={iconSize.lg} color={theme.color.brand} />
      {dot ? (
        <View
          style={{
            position: 'absolute',
            top: 9,
            end: 10,
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: theme.color.negative,
          }}
        />
      ) : null}
    </Pressable>
  );
}
