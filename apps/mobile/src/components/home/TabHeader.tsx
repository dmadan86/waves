/**
 * The header of a bottom-bar tab root on the personal side: the space pill at
 * the start, round hairline icon buttons at the end, all on the page colour.
 * No photo, no greeting, no back button (it is a tab). Sub-screens use
 * `ScenicHeader`.
 */

import type { ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { iconSize, Row, useTheme } from '@waves/ui';

import { useHeroStatusBar } from '@/components/ScreenHero';

export function TabHeader({ left, children }: { left: ReactNode; children?: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  useHeroStatusBar(theme.scheme === 'dark' ? 'light' : 'dark');
  return (
    <Row
      style={{
        alignItems: 'center',
        gap: theme.spacing.sm,
        paddingTop: insets.top + theme.spacing.xs,
        paddingBottom: theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>{left}</View>
      {children}
    </Row>
  );
}

/** A 40dp round button with a hairline: bell, ⋮, search. `dot` marks news. */
export function TabIconButton({
  icon,
  label,
  onPress,
  dot = false,
  buttonRef,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  dot?: boolean;
  buttonRef?: React.RefObject<View | null>;
}) {
  const theme = useTheme();
  return (
    <Pressable
      ref={buttonRef}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.color.surface,
        borderWidth: 1,
        borderColor: theme.color.border,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={iconSize.lg} color={theme.color.text} />
      {dot ? (
        <View
          style={{
            position: 'absolute',
            top: 8,
            end: 9,
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
