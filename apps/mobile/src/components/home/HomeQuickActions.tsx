/**
 * The four things you start from Home, as a row of tiles under the balance
 * card: add an expense, split a bill, settle up, start a group.
 *
 * Add expense is the one filled in the brand wash — it is what Home is opened
 * for most often — and it keeps the long press that raises the type / scan /
 * speak sheet. The others are white tiles with a brand glyph. Add expense and
 * New group keep their tour anchors, so the coach-marks still spotlight them.
 */

import type { ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { Gradient, Text, useTheme } from '@waves/ui';

import { GroupAddIcon } from '@/components/GroupAddIcon';
import { useStrings } from '@/i18n';
import { TourTarget } from '@/lib/tour';

interface QuickAction {
  key: string;
  label: string;
  glyph: (color: string) => ReactNode;
  onPress: () => void;
  onLongPress?: () => void;
  tourId?: string;
  primary?: boolean;
}

export function HomeQuickActions({
  onAddExpense,
  onAddExpenseLong,
  onSplitBill,
  onSettleUp,
  onNewGroup,
  gradient,
}: {
  onAddExpense: () => void;
  onAddExpenseLong: () => void;
  onSplitBill: () => void;
  onSettleUp: () => void;
  onNewGroup: () => void;
  /** The hero's wash, so the primary tile is cut from the same cloth. */
  gradient: readonly string[];
}) {
  const theme = useTheme();
  const { t } = useStrings();

  const actions: QuickAction[] = [
    {
      key: 'expense',
      label: t.homeDash.addExpense,
      glyph: (color) => <Ionicons name="add" size={28} color={color} />,
      onPress: onAddExpense,
      onLongPress: onAddExpenseLong,
      tourId: 'addExpense',
      primary: true,
    },
    {
      key: 'split',
      label: t.homeDash.splitBill,
      glyph: (color) => <Ionicons name="receipt-outline" size={24} color={color} />,
      onPress: onSplitBill,
    },
    {
      key: 'settle',
      label: t.homeDash.settleUp,
      glyph: (color) => <Ionicons name="swap-horizontal" size={24} color={color} />,
      onPress: onSettleUp,
    },
    {
      key: 'group',
      label: t.homeDash.newGroup,
      glyph: (color) => <GroupAddIcon size={20} color={color} />,
      onPress: onNewGroup,
      tourId: 'addGroup',
    },
  ];

  return (
    <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
      {actions.map((action) => {
        const ink = action.primary ? theme.color.onBrand : theme.color.brand;
        const face = (
          <View
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              gap: theme.spacing.xs,
              paddingVertical: theme.spacing.md,
              paddingHorizontal: theme.spacing.xs,
              minHeight: 84,
            }}
          >
            {action.glyph(ink)}
            <Text
              variant="caption"
              align="center"
              numberOfLines={2}
              style={{
                fontWeight: '600',
                color: action.primary ? theme.color.onBrand : theme.color.text,
              }}
            >
              {action.label}
            </Text>
          </View>
        );
        const tile = (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={action.onPress}
            onLongPress={action.onLongPress}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            {action.primary ? (
              <Gradient colors={gradient} radius={theme.radius.lg}>
                {face}
              </Gradient>
            ) : (
              <View
                style={{
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.color.surface,
                  borderWidth: 1,
                  borderColor: theme.color.border,
                }}
              >
                {face}
              </View>
            )}
          </Pressable>
        );
        return (
          <View key={action.key} style={{ flex: 1 }}>
            {action.tourId ? <TourTarget id={action.tourId}>{tile}</TourTarget> : tile}
          </View>
        );
      })}
    </View>
  );
}
