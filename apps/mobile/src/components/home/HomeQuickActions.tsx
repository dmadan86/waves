/**
 * The actions you start from Home — scan a bill, remind, settle up, earn
 * credits, add an expense — as a strip along the foot of the balance card rather than
 * a row of tiles of their own: a small disc over a one-line word in each
 * column, so the actions cost the card a band instead of the screen a block.
 *
 * Free users get a compact credits sheet. A low balance
 * highlights that action while keeping every disc and label aligned.
 *
 * Draws itself with `QuickActionsRow`, the same disc-and-label strip
 * Friends' own quick actions use — brand-tinted here, lilac there.
 */

import { useQuery } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useTheme } from '@waves/ui';

import { QuickActionsRow, type QuickAction } from '@/components/home/QuickActionsRow';
import { fill, useStrings } from '@/i18n';
import { queryCredits } from '@/lib/adCredits';
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
  onScan,
  onRemind,
  radius,
}: {
  onAddExpense: () => void;
  onAddExpenseLong: () => void;
  onSettleUp: () => void;
  /** Company users: opens Review, which has no tab of its own for them. */
  onReview: () => void;
  onScan: () => void;
  /** Opens Friends, where each balance carries its own nudge. */
  onRemind: () => void;
  /** The card's corner radius, which the strip's bottom corners follow. */
  radius: number;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const viewerId = useViewerId();
  const { isPaid } = useEntitlement();
  const adOffer = useRewardedAdOffer();
  const credits = useQuery({
    queryKey: ['credits', viewerId],
    queryFn: queryCredits,
    enabled: !!viewerId,
  });

  const isReview = homeSecondActionKey(useViewerCompanyIds()) === 'review';
  // Same folded count as the Review tab's badge.
  const reviewBadge = captureInboxActionState(foldedCaptureCount(useCaptures().data ?? [])).badge;

  const balance = credits.data?.credits;
  const creditAction = homeCreditsAction(balance, credits.data?.costs.voice);

  const actions: QuickAction[] = [
    {
      key: 'scan',
      label: t.scanBill,
      glyph: (color) => <Ionicons name="scan-outline" size={28} color={color} />,
      onPress: onScan,
    },
    {
      key: 'remind',
      label: t.people.remind,
      glyph: (color) => <Ionicons name="alarm-outline" size={28} color={color} />,
      onPress: onRemind,
    },
    isReview
      ? {
          key: 'review',
          label: t.review,
          badge: reviewBadge,
          badgeColor: theme.color.negative,
          glyph: (color) => <Ionicons name="file-tray-full-outline" size={28} color={color} />,
          onPress: onReview,
        }
      : {
          key: 'settle',
          label: t.homeDash.settleUp,
          glyph: (color) => <Ionicons name="cash-outline" size={28} color={color} />,
          onPress: onSettleUp,
        },
    ...(viewerId && !isPaid
      ? [
          {
            key: 'credits',
            label: fill(t.homeDash[creditAction.labelKey], { n: balance ?? 0 }),
            badge: creditAction.badge,
            badgeColor: theme.color.brand,
            accessibilityLabel: `${fill(t.credits.balance, { n: balance ?? 0 })}. ${t.homeDash.getCredits}`,
            glyph: () => <Ionicons name="flash" size={28} color={theme.color.warning} />,
            onPress: () => void adOffer.offer('voice', { userInitiated: true, homeCredits: true }),
          },
        ]
      : []),
    // Last, at the right-hand end: the one reached for most, under the thumb.
    {
      key: 'expense',
      label: t.homeDash.addExpense,
      glyph: (color) => <Ionicons name="add-circle-outline" size={28} color={color} />,
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
        discColor="transparent"
        iconColor={theme.color.brand}
        discSize={32}
        rowPadding={theme.spacing.sm}
      />
      {adOffer.sheet}
    </>
  );
}
