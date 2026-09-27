/**
 * The four things you start from Home — add an expense, start a group, settle
 * up, the reports — as a strip along the foot of the balance card rather than
 * a row of tiles of their own: a small disc over a one-line word in each
 * quarter, so the actions cost the card a band instead of the screen a block.
 *
 * Add expense's disc is filled in the hero's wash — it is what Home is opened
 * for most often — and keeps the long press that raises the type / scan /
 * speak sheet. Add expense and New group keep their tour anchors, so the
 * coach-marks still spotlight them.
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
  onReports,
  onSettleUp,
  onNewGroup,
  gradient,
  radius,
}: {
  onAddExpense: () => void;
  onAddExpenseLong: () => void;
  onReports: () => void;
  onSettleUp: () => void;
  onNewGroup: () => void;
  /** The hero's wash, so the primary tile is cut from the same cloth. */
  gradient: readonly string[];
  /** The card's corner radius, which the strip's bottom corners follow. */
  radius: number;
}) {
  const theme = useTheme();
  const { t } = useStrings();

  const actions: QuickAction[] = [
    {
      key: 'expense',
      label: t.homeDash.addExpense,
      glyph: (color) => <Ionicons name="add" size={20} color={color} />,
      onPress: onAddExpense,
      onLongPress: onAddExpenseLong,
      tourId: 'addExpense',
      primary: true,
    },
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
  ];

  // The strip along the foot of the balance card: four equal columns, each a
  // small disc over a one-line word. Add expense's disc is filled in the wash;
  // the rest are soft brand discs. It carries the card's own bottom corners so
  // it can run edge to edge without the card clipping (and losing its shadow).
  const track = theme.scheme === 'dark' ? theme.color.surfaceMuted : '#F6F4FE';
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: track,
        borderTopWidth: 1,
        borderTopColor: theme.color.border,
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
              backgroundColor: action.primary ? undefined : theme.color.brandSoft,
              overflow: 'hidden',
            }}
          >
            {action.primary ? (
              <Gradient
                colors={gradient}
                radius={DISC / 2}
                style={{
                  width: DISC,
                  height: DISC,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {action.glyph(theme.color.onBrand)}
              </Gradient>
            ) : (
              action.glyph(theme.color.brand)
            )}
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
              style={{
                fontWeight: action.primary ? '700' : '600',
                color: action.primary ? theme.color.brand : theme.color.text,
              }}
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
