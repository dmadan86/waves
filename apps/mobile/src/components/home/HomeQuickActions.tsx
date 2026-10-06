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
 *
 * Draws itself with `QuickActionsRow`, the same disc-and-label strip
 * Friends' own quick actions use — brand-tinted here, lilac there.
 */

import { useRef } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { View } from 'react-native';

import { useTheme } from '@waves/ui';

import { GroupAddIcon } from '@/components/GroupAddIcon';
import { QuickActionsRow, type QuickAction } from '@/components/home/QuickActionsRow';
import type { MenuAnchor } from '@/components/home/NewGroupMenu';
import { measureAnchor } from '@/lib/measureAnchor';
import { useStrings } from '@/i18n';

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
  /** Handed the tile's window position so the menu can drop from it. */
  onNewGroup: (anchor: MenuAnchor | null) => void;
  /** The card's corner radius, which the strip's bottom corners follow. */
  radius: number;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const groupRef = useRef<View>(null);

  const actions: QuickAction[] = [
    {
      key: 'group',
      label: t.homeDash.newGroup,
      glyph: (color) => <GroupAddIcon size={13} color={color} />,
      onPress: () => measureAnchor(groupRef, onNewGroup),
      ref: groupRef,
      tourId: 'addGroup',
    },
    {
      key: 'settle',
      label: t.homeDash.settleUp,
      glyph: (color) => <Ionicons name="cash-outline" size={16} color={color} />,
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

  return (
    <QuickActionsRow
      actions={actions}
      radius={radius}
      discColor={theme.color.brandSoft}
      iconColor={theme.color.brand}
      rowPadding={theme.spacing.xs}
    />
  );
}
