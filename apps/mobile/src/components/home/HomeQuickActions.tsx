/**
 * The four things you start from Home — start a group, settle up, the reports,
 * add an expense — as a strip along the foot of the balance card rather than
 * a row of tiles of their own: a small disc over a one-line word in each
 * quarter, so the actions cost the card a band instead of the screen a block.
 *
 * Add expense sits at the right-hand end, where a right thumb rests — it is
 * what Home is opened for most often — and keeps the long press that raises
 * the type / scan / speak sheet. All four wear the same quiet disc: none is
 * lit up over the others. Add expense and New group keep their tour anchors,
 * so the coach-marks still spotlight them.
 */

import type { ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { Text, useTheme } from '@waves/ui';

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
}

export function HomeQuickActions({
  onAddExpense,
  onAddExpenseLong,
  onReports,
  onSettleUp,
  onNewGroup,
  radius,
}: {
  onAddExpense: () => void;
  onAddExpenseLong: () => void;
  onReports: () => void;
  onSettleUp: () => void;
  onNewGroup: () => void;
  /** The card's corner radius, which the strip's bottom corners follow. */
  radius: number;
}) {
  const theme = useTheme();
  const { t } = useStrings();

  const actions: QuickAction[] = [
    {
      key: 'group',
      label: t.homeDash.newGroup,
      glyph: (color) => <GroupAddIcon size={13} color={color} />,
      onPress: onNewGroup,
      tourId: 'addGroup',
    },
    {
      key: 'settle',
      label: t.homeDash.settleUp,
      glyph: (color) => <Ionicons name="swap-horizontal" size={16} color={color} />,
      onPress: onSettleUp,
    },
    {
      key: 'reports',
      label: t.homeDash.reports,
      glyph: (color) => <Ionicons name="stats-chart" size={16} color={color} />,
      onPress: onReports,
    },
    // Last, at the right-hand end: the one reached for most, under the thumb.
    {
      key: 'expense',
      label: t.homeDash.addExpense,
      glyph: (color) => <Ionicons name="add" size={20} color={color} />,
      onPress: onAddExpense,
      onLongPress: onAddExpenseLong,
      tourId: 'addExpense',
    },
  ];

  // The strip along the foot of the balance card: four equal columns, each a
  // small soft brand disc over a one-line word. It carries the card's own bottom corners so
  // it can run edge to edge without the card clipping (and losing its shadow).
  // No fill and no rule of its own: the card's landscape runs on under the
  // actions, so the strip reads as part of the card rather than a band cut
  // off from it.
  return (
    <View
      style={{
        flexDirection: 'row',
        borderBottomLeftRadius: radius,
        borderBottomRightRadius: radius,
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.xs,
      }}
    >
      {actions.map((action) => {
        const disc = (
          <View
            style={{
              width: DISC,
              height: DISC,
              borderRadius: DISC / 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.brandSoft,
            }}
          >
            {action.glyph(theme.color.brand)}
          </View>
        );
        const button = (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={action.onPress}
            onLongPress={action.onLongPress}
            hitSlop={4}
            style={({ pressed }) => ({
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: 2,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            {disc}
            <Text
              variant="micro"
              align="center"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              style={{ fontWeight: '600', color: theme.color.text }}
            >
              {action.label}
            </Text>
          </Pressable>
        );
        return (
          <View key={action.key} style={{ flex: 1 }}>
            {action.tourId ? <TourTarget id={action.tourId}>{button}</TourTarget> : button}
          </View>
        );
      })}
    </View>
  );
}

const DISC = 34;
