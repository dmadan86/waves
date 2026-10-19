/**
 * The one card a save ends in: a round check, the amount large, one muted line
 * under it ("Food · Personal") and whatever the caller puts below (Undo). The
 * status line under the mic says "Saved"; this card never repeats it.
 */

import type { ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { iconSize, Text, useTheme } from '@waves/ui';

export function SavedSummary({
  amount,
  detail,
  editLabel,
  onEdit,
  children,
}: {
  amount: string;
  detail: string;
  /** Screen-reader label for the pencil; omitted with `onEdit` when there is no pencil. */
  editLabel?: string;
  onEdit?: () => void;
  children?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        alignItems: 'center',
        gap: theme.spacing.xs,
        padding: theme.spacing.lg,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.color.surface,
        ...theme.shadow.soft,
      }}
    >
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.color.brand,
        }}
      >
        <Ionicons name="checkmark" size={iconSize.xl} color={theme.color.onBrand} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
        <Text style={{ fontSize: 34, lineHeight: 42, fontWeight: '800' }}>{amount}</Text>
        {onEdit ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={editLabel}
            onPress={onEdit}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Ionicons name="create-outline" size={iconSize.base} color={theme.color.brand} />
          </Pressable>
        ) : null}
      </View>
      {detail ? (
        <Text tone="muted" align="center" numberOfLines={2}>
          {detail}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

/** A plain text button, 44 dp tall, for Undo and Add another. */
export function TextAction({
  label,
  onPress,
  accessibilityLabel,
  disabled,
  muted,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
  muted?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        paddingHorizontal: theme.spacing.md,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
      })}
    >
      <Text style={{ color: muted ? theme.color.textMuted : theme.color.brand, fontWeight: '700' }}>
        {label}
      </Text>
    </Pressable>
  );
}
