/**
 * The four things you start from Home, as a row of discs on a frosted panel
 * under the balance card: add an expense, create a group, settle up, and the
 * reports. Each is a disc with its glyph and a word under it, split into equal
 * quarters by hairlines so the row reads as one control strip.
 *
 * Add expense is the one filled in colour — it is what Home is opened for most
 * often — and it keeps the long press that raises the type / scan / speak
 * sheet. The first two keep their tour anchors, so the coach-marks still
 * spotlight them.
 */

import type { ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { Text, useTheme } from '@waves/ui';

import { GroupAddIcon } from '@/components/GroupAddIcon';
import { useStrings } from '@/i18n';
import { TourTarget } from '@/lib/tour';

import { FROSTED } from './HomeBalanceCard';

const DISC = 52;

interface QuickAction {
  key: string;
  label: string;
  /** Spoken in place of the label, when the label alone would be ambiguous. */
  spoken?: string;
  glyph: ReactNode;
  disc: string;
  onPress: () => void;
  onLongPress?: () => void;
  tourId?: string;
}

export function HomeQuickActions({
  onAddExpense,
  onAddExpenseLong,
  onCreateGroup,
  onSettleUp,
  onReports,
}: {
  onAddExpense: () => void;
  onAddExpenseLong: () => void;
  onCreateGroup: () => void;
  onSettleUp: () => void;
  onReports: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const brand = theme.gradient.brand[0] ?? theme.color.brand;

  const actions: QuickAction[] = [
    {
      key: 'expense',
      label: t.homeDash.addExpense,
      glyph: <Ionicons name="add" size={30} color="#15803D" />,
      disc: '#BBF7D0',
      onPress: onAddExpense,
      onLongPress: onAddExpenseLong,
      tourId: 'addExpense',
    },
    {
      key: 'group',
      label: t.homeDash.createGroup,
      glyph: <GroupAddIcon size={22} color={brand} />,
      disc: '#EDE9FE',
      onPress: onCreateGroup,
      tourId: 'addGroup',
    },
    {
      key: 'settle',
      label: t.homeDash.settleUp,
      glyph: <Ionicons name="swap-horizontal" size={24} color="#1D4ED8" />,
      disc: '#DBEAFE',
      onPress: onSettleUp,
    },
    {
      key: 'reports',
      label: t.homeDash.viewReports,
      glyph: <Ionicons name="stats-chart" size={22} color={brand} />,
      disc: '#FFFFFF',
      onPress: onReports,
    },
  ];

  return (
    <View
      style={{
        ...FROSTED,
        borderRadius: theme.radius.xl,
        paddingVertical: theme.spacing.md,
        flexDirection: 'row',
      }}
    >
      {actions.map((action, index) => {
        const button = (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action.spoken ?? action.label}
            onPress={action.onPress}
            onLongPress={action.onLongPress}
            style={({ pressed }) => ({
              alignItems: 'center',
              gap: theme.spacing.sm,
              paddingHorizontal: theme.spacing.xs,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <View
              style={{
                width: DISC,
                height: DISC,
                borderRadius: DISC / 2,
                backgroundColor: action.disc,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {action.glyph}
            </View>
            <Text
              variant="caption"
              tone="onBrand"
              align="center"
              numberOfLines={2}
              style={{ fontWeight: '600' }}
            >
              {action.label}
            </Text>
          </Pressable>
        );
        return (
          <View
            key={action.key}
            style={{
              flex: 1,
              borderStartWidth: index === 0 ? 0 : 1,
              borderStartColor: 'rgba(255, 255, 255, 0.14)',
            }}
          >
            {action.tourId ? <TourTarget id={action.tourId}>{button}</TourTarget> : button}
          </View>
        );
      })}
    </View>
  );
}
