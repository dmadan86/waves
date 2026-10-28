/**
 * The actions you start from Home — start a group, settle up, earn credits,
 * add an expense — as a strip along the foot of the balance card rather than
 * a row of tiles of their own: a small disc over a one-line word in each
 * column, so the actions cost the card a band instead of the screen a block.
 *
 * Free users get a compact credits sheet. A low balance
 * highlights that action while keeping every disc and label aligned.
 *
 * Draws itself with `QuickActionsRow`, the same disc-and-label strip
 * Friends' own quick actions use — brand-tinted here, lilac there.
 */

import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import { useTheme } from '@waves/ui';

import { GroupAddIcon } from '@/components/GroupAddIcon';
import { QuickActionsRow, type QuickAction } from '@/components/home/QuickActionsRow';
import type { MenuAnchor } from '@/components/home/NewGroupMenu';
import { measureAnchor } from '@/lib/measureAnchor';
import { fill, useStrings } from '@/i18n';
import { readCredits } from '@/lib/adCredits';
import { useViewerId } from '@/lib/auth';
import { useCaptures } from '@/data/hooks';
import { foldedCaptureCount } from '@/lib/captureBatch';
import { homeSecondActionKey } from '@/lib/companyTab';
import { captureInboxActionState } from '@/lib/dashboardActions';
import { useViewerCompanyIds } from '@/lib/useCompanyTab';
import { homeCreditsAction } from '@/lib/isHomeCreditsLow';
import { useEntitlement } from '@/lib/useEntitlement';
import { useRewardedAdOffer } from '@/lib/useRewardedAdOffer';

export function HomeQuickActions({
  onAddExpense,
  onAddExpenseLong,
  onSettleUp,
  onReview,
  onNewGroup,
  radius,
}: {
  onAddExpense: () => void;
  onAddExpenseLong: () => void;
  onSettleUp: () => void;
  /** Company users: opens Review, which has no tab of its own for them. */
  onReview: () => void;
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
  const adOffer = useRewardedAdOffer();
  const credits = useQuery({
    queryKey: ['credits', viewerId],
    queryFn: readCredits,
    enabled: !!viewerId,
  });

  const isReview = homeSecondActionKey(useViewerCompanyIds()) === 'review';
  // Same folded count as the Review tab's badge.
  const reviewBadge = captureInboxActionState(foldedCaptureCount(useCaptures().data ?? [])).badge;

  const balance = credits.data?.credits;
  const creditAction = homeCreditsAction(balance, credits.data?.costs.voice);

  const actions: QuickAction[] = [
    {
      key: 'group',
      label: t.homeDash.newGroup,
      glyph: (color) => <GroupAddIcon size={24} color={color} />,
      onPress: () => measureAnchor(groupRef, onNewGroup),
      ref: groupRef,
      tourId: 'addGroup',
    },
    isReview
      ? {
          key: 'review',
          label: t.review,
          badge: reviewBadge,
          badgeColor: theme.color.brand,
          glyph: (color) => <Ionicons name="file-tray-full-outline" size={24} color={color} />,
          onPress: onReview,
        }
      : {
          key: 'settle',
          label: t.homeDash.settleUp,
          glyph: (color) => <Ionicons name="cash-outline" size={24} color={color} />,
          onPress: onSettleUp,
        },
    ...(viewerId && !isPaid
      ? [
          {
            key: 'credits',
            label: fill(t.homeDash[creditAction.labelKey], { n: balance ?? 0 }),
            badge: creditAction.badge,
            badgeColor: theme.color.brand,
            tileColor: theme.color.warningSoft,
            tileInk: theme.color.text,
            accessibilityLabel: `${fill(t.credits.balance, { n: balance ?? 0 })}. ${t.homeDash.getCredits}`,
            glyph: () => <Ionicons name="flash" size={24} color={theme.color.warning} />,
            onPress: () => void adOffer.offer('voice', { userInitiated: true, homeCredits: true }),
          },
        ]
      : []),
    // Last, at the right-hand end: the one reached for most, under the thumb.
    {
      key: 'expense',
      label: t.homeDash.addExpense,
      glyph: () => (
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.brand,
          }}
        >
          <Ionicons name="add" size={20} color={theme.color.onBrand} />
        </View>
      ),
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
        tile
      />
      {adOffer.sheet}
    </>
  );
}
