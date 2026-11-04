import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { iconSize, Row, Text, useTheme } from '@waves/ui';

import { TourTarget } from '@/lib/tour';
import type { MenuAnchor } from '@/components/home/NewGroupMenu';
import { measureAnchor } from '@/lib/measureAnchor';
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

function ActionButton(opts: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  onLongPress?: () => void;
  primary?: boolean;
  badge?: number;
}) {
  const theme = useTheme();
  const brand = theme.color.brand;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={opts.badge != null ? `${opts.label} (${opts.badge})` : opts.label}
      onPress={opts.onPress}
      onLongPress={opts.onLongPress}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingHorizontal: theme.spacing.sm,
        borderRadius: theme.radius.md,
        backgroundColor: opts.primary ? brand : theme.color.surface,
        borderWidth: opts.primary ? 0 : 1,
        borderColor: theme.color.border,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={opts.icon} size={18} color={opts.primary ? theme.color.onBrand : brand} />
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        style={{
          flexShrink: 1,
          fontWeight: '600',
          fontSize: 14,
          color: opts.primary ? theme.color.onBrand : theme.color.text,
        }}
      >
        {opts.label}
      </Text>
      {opts.badge ? (
        <View
          style={{
            minWidth: 18,
            height: 18,
            paddingHorizontal: 4,
            borderRadius: 6,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.negative,
          }}
        >
          <Text variant="micro" style={{ color: '#FFFFFF', fontWeight: '700' }}>
            {opts.badge > 99 ? '99+' : String(opts.badge)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * The actions you start from Home, as one compact row under the balance:
 * Add expense (the primary, brand-filled; hold for type / scan / speak),
 * New group and Settle up (outlined). Free users also get a quiet credits
 * link underneath; a low balance shows its count as a small tag.
 */
export function HomeQuickActions({
  onAddExpense,
  onAddExpenseLong,
  onSettleUp,
  onReview,
  onNewGroup,
}: {
  onAddExpense: () => void;
  onAddExpenseLong: () => void;
  onSettleUp: () => void;
  /** Company users: opens Review, which has no tab of its own for them. */
  onReview: () => void;
  /** Handed the button's window position so the menu can drop from it. */
  onNewGroup: (anchor: MenuAnchor | null) => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const groupRef = useRef<View>(null);
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
  const brand = theme.color.brand;

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Row style={{ gap: theme.spacing.sm }}>
        <TourTarget id="addExpense" style={{ flex: 1.3 }}>
          <ActionButton
            label={t.homeDash.addExpense}
            icon="add"
            onPress={onAddExpense}
            onLongPress={onAddExpenseLong}
            primary
          />
        </TourTarget>
        <View ref={groupRef} collapsable={false} style={{ flex: 1 }}>
          <TourTarget id="addGroup">
            <ActionButton
              label={t.homeDash.newGroup}
              icon="people-outline"
              onPress={() => measureAnchor(groupRef, onNewGroup)}
            />
          </TourTarget>
        </View>
        <View style={{ flex: 1 }}>
          {isReview ? (
            <ActionButton
              label={t.review}
              icon="file-tray-full-outline"
              onPress={onReview}
              badge={reviewBadge}
            />
          ) : (
            <ActionButton label={t.homeDash.settleUp} icon="cash-outline" onPress={onSettleUp} />
          )}
        </View>
      </Row>
      {viewerId && !isPaid ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${fill(t.credits.balance, { n: balance ?? 0 })}. ${t.homeDash.getCredits}`}
          onPress={() => void adOffer.offer('voice', { userInitiated: true, homeCredits: true })}
          hitSlop={8}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            alignSelf: 'flex-start',
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Ionicons name="flash" size={iconSize.sm} color={theme.color.warning} />
          <Text variant="caption" style={{ fontWeight: '600', color: brand }}>
            {fill(t.homeDash[creditAction.labelKey], { n: balance ?? 0 })}
          </Text>
          {creditAction.badge != null ? (
            <View
              style={{
                paddingHorizontal: 6,
                paddingVertical: 1,
                borderRadius: 6,
                backgroundColor: theme.color.brandSoft,
              }}
            >
              <Text variant="micro" tone="brand" style={{ fontWeight: '700' }}>
                {creditAction.badge}
              </Text>
            </View>
          ) : null}
        </Pressable>
      ) : null}
      {adOffer.sheet}
    </View>
  );
}
