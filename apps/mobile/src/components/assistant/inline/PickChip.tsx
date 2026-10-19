/**
 * A tap chip for the inline sheets: a group, a person, a "who had this" choice.
 * 44 pt tall (the app's touch minimum), labelled for screen readers, and it
 * says whether it is selected.
 */

import { Pressable } from 'react-native';

import { Text, useTheme } from '@waves/ui';

import { chipLabel } from '@/lib/followUpApply';

export function PickChip({
  label,
  selected,
  onPress,
  disabled = false,
  accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        minWidth: 44,
        justifyContent: 'center',
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radius.pill,
        borderWidth: 1,
        borderColor: selected ? theme.color.brand : theme.color.border,
        backgroundColor: selected ? theme.color.brandSoft : theme.color.bg,
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
      })}
    >
      <Text
        numberOfLines={1}
        style={{ color: theme.color.text, fontWeight: selected ? '700' : '500' }}
      >
        {chipLabel(label, 22)}
      </Text>
    </Pressable>
  );
}
