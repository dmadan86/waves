/**
 * The actions you start from Home — start a group, settle up, earn credits,
 * add an expense — as a strip along the foot of the balance card rather than
 * a row of tiles of their own: a small disc over a one-line word in each
 * column, so the actions cost the card a band instead of the screen a block.
 *
 * Free users get a credits badge and an add-credits pill. A low balance
 * highlights that action while keeping every disc and label aligned.
 *
 * Draws itself with `QuickActionsRow`, the same disc-and-label strip
 * Friends' own quick actions use — brand-tinted here, lilac there.
 */

import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { View } from 'react-native';

import { useTheme } from '@waves/ui';

import { GroupAddIcon } from '@/components/GroupAddIcon';
import { QuickActionsRow, type QuickAction } from '@/components/home/QuickActionsRow';
import type { MenuAnchor } from '@/components/home/NewGroupMenu';
import { measureAnchor } from '@/lib/measureAnchor';
import { useStrings } from '@/i18n';
import { readCredits } from '@/lib/adCredits';
import { useViewerId } from '@/lib/auth';
import { isHomeCreditsLow } from '@/lib/isHomeCreditsLow';
import { useEntitlement } from '@/lib/useEntitlement';
import { useRewardedAdOffer } from '@/lib/useRewardedAdOffer';
import { useToast } from '@/lib/toast';

export function HomeQuickActions({
  onAddExpense,
  onAddExpenseLong,
  onSettleUp,
  onNewGroup,
  radius,
}: {
  onAddExpense: () => void;
  onAddExpenseLong: () => void;
  onSettleUp: () => void;
  /** Handed the tile's window position so the menu can drop from it. */
  onNewGroup: (anchor: MenuAnchor | null) => void;
  /** The card's corner radius, which the strip's bottom corners follow. */
  radius: number;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const groupRef = useRef<View>(null);
  const viewerId = useViewerId();
  const { isPaid } = useEntitlement();
  const toast = useToast();
  const adOffer = useRewardedAdOffer();
  const credits = useQuery({
    queryKey: ['credits', viewerId],
    queryFn: readCredits,
    enabled: !!viewerId,
  });

  const balance = credits.data?.credits;
  const lowCredits = isHomeCreditsLow(balance, credits.data?.costs.voice);

  const actions: QuickAction[] = [
    {
      key: 'group',
      label: t.homeDash.newGroup,
      glyph: (color) => <GroupAddIcon size={17} color={color} />,
      onPress: () => measureAnchor(groupRef, onNewGroup),
      ref: groupRef,
      tourId: 'addGroup',
    },
    {
      key: 'settle',
      label: t.homeDash.settleUp,
      glyph: (color) => <Ionicons name="cash-outline" size={20} color={color} />,
      onPress: onSettleUp,
    },
    ...(viewerId && !isPaid
      ? [
          {
            key: 'credits',
            label: t.homeDash.creditsTitle,
            badge: balance ?? undefined,
            badgeColor: lowCredits ? theme.color.negative : theme.color.brand,
            backgroundColor: lowCredits ? theme.color.negativeSoft : undefined,
            pillLabel: t.homeDash.addCredits,
            accessibilityLabel:
              balance == null
                ? `${t.homeDash.creditsTitle}. ${t.homeDash.addCredits}`
                : t.homeDash.creditsAccessibility.replace('{n}', String(balance)),
            glyph: (color: string) => <Ionicons name="flash" size={19} color={color} />,
            onPress: () => {
              if (!adOffer.canOffer('voice', { userInitiated: true })) {
                toast.show(t.homeDash.noAdAvailable);
                return;
              }
              void adOffer.offer('voice', { userInitiated: true });
            },
          },
        ]
      : []),
    // Last, at the right-hand end: the one reached for most, under the thumb.
    {
      key: 'expense',
      label: t.homeDash.addExpense,
      glyph: (color) => <Ionicons name="add" size={24} color={color} />,
      onPress: onAddExpense,
      onLongPress: onAddExpenseLong,
      tourId: 'addExpense',
    },
  ];

  return (
    <>
      <QuickActionsRow
        actions={actions}
        radius={radius}
        discColor={theme.color.brandSoft}
        iconColor={theme.color.brand}
        rowPadding={theme.spacing.xs}
      />
      {adOffer.sheet}
    </>
  );
}
