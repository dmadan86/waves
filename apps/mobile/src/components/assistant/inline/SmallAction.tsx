/** A text action with a 44 pt target, for the inline rows (Retry, Remove, Show all). */

import { Pressable } from 'react-native';

import { Text, useTheme } from '@waves/ui';

export function SmallAction({
  label,
  onPress,
  accessibilityLabel,
  disabled = false,
  expanded,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
  expanded?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled, ...(expanded === undefined ? null : { expanded }) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        minWidth: 44,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: theme.spacing.sm,
        opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
      })}
    >
      <Text variant="caption" style={{ color: theme.color.brand, fontWeight: '700' }}>
        {label}
      </Text>
    </Pressable>
  );
}
