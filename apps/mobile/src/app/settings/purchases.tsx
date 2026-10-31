/**
 * Purchases: the plan, when it renews, and the ways to get a receipt.
 *
 * Display only. What is shown comes from CustomerInfo (renewal) and the
 * person's own `subscriptions` row (price paid); the store sends the receipts.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, View } from 'react-native';

import { isPaidTier } from '@waves/core';
import {
  Badge,
  Button,
  EmptyState,
  iconSize,
  Row,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { ListRow, PlainHeader, RowTile, SectionHeader, StandardCard } from '@/components/standard';
import { fill, useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { backend } from '@/lib/backend';
import { dateTimeFormat } from '@/lib/dateTimeFormat';
import { router } from '@/lib/navigation';
import { reportHandled } from '@/lib/observability';
import {
  activeEntitlement,
  isYearly,
  purchaseStatus,
  storeKind,
  type PurchaseStatus,
  type SubscriptionRow,
} from '@/lib/purchaseStatus';
import { manageSubscription, restore, useCustomerTier } from '@/lib/purchases';
import { useToast } from '@/lib/toast';

const RECEIPT_URL = {
  apple: 'https://reportaproblem.apple.com',
  play: 'https://play.google.com/store/account/orderhistory',
};

const PILL_TONE: Record<PurchaseStatus, 'positive' | 'negative' | 'brand' | 'neutral'> = {
  active: 'positive',
  trial: 'brand',
  renewsOff: 'neutral',
  billingIssue: 'negative',
  expired: 'neutral',
  refunded: 'neutral',
  promo: 'brand',
};

export default function PurchasesScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const toast = useToast();
  const viewerId = useViewerId();
  const { info } = useCustomerTier();
  const [restoring, setRestoring] = useState(false);

  const query = useQuery({
    queryKey: ['mySubscription', viewerId],
    enabled: viewerId !== null,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<SubscriptionRow | null> => {
      const { data, error } = await backend
        .from('subscriptions')
        .select(
          'tier, period, status, current_period_end, store, store_txn_id, price_minor, currency',
        )
        .order('current_period_end', { ascending: false })
        .limit(10);
      if (error) throw error;
      // A referral/promo row can outlive the paid one: show the store purchase.
      const rows = (data ?? []) as SubscriptionRow[];
      return rows.find((r) => storeKind(r.store) !== 'none') ?? rows[0] ?? null;
    },
  });
  const row = query.data ?? null;
  const ent = activeEntitlement(info);
  const status = purchaseStatus(info, row);
  const p = t.purchases;

  const kind = storeKind(ent?.store ?? row?.store);
  const wrongPlatform =
    (kind === 'play' && Platform.OS === 'ios') || (kind === 'apple' && Platform.OS !== 'ios');
  const receiptStore = kind === 'none' ? (Platform.OS === 'ios' ? 'apple' : 'play') : kind;
  const storeName = kind === 'play' ? p.googlePlay : kind === 'apple' ? p.appStore : null;

  const date = (iso: string | null | undefined): string | null => {
    const d = iso ? new Date(iso) : null;
    return d && !Number.isNaN(d.getTime())
      ? dateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(d)
      : null;
  };
  const end = date(ent?.expirationDate ?? row?.current_period_end);
  const dateLine = !end
    ? null
    : status === 'promo'
      ? fill(p.promoUntil, { date: end })
      : status === 'active' || status === 'trial' || status === 'billingIssue'
        ? fill(p.renews, { date: end })
        : fill(status === 'expired' || status === 'refunded' ? p.ended : p.ends, { date: end });

  let price: string | null = null;
  if (row?.price_minor != null && row.currency) {
    try {
      const fmt = new Intl.NumberFormat(locale, { style: 'currency', currency: row.currency });
      price = fmt.format(row.price_minor / 10 ** fmt.resolvedOptions().maximumFractionDigits!);
    } catch {
      price = null;
    }
  }
  const priceLine = [price, storeName].filter(Boolean).join(' · ');

  const onManage = () => {
    manageSubscription().catch((error: unknown) => {
      reportHandled(error, 'purchases.manageSubscription');
      toast.show(t.paywall.genericError, 'negative');
    });
  };
  const onRestore = async () => {
    setRestoring(true);
    try {
      const found = isPaidTier(await restore());
      toast.show(
        found ? t.paywall.restoredSuccess : t.paywall.restoredNothing,
        found ? 'positive' : 'info',
      );
    } catch {
      toast.show(t.paywall.genericError, 'negative');
    } finally {
      setRestoring(false);
    }
  };
  const orderId = row?.store_txn_id ?? null;
  const copyOrder = () => {
    if (!orderId) return;
    void Clipboard.setStringAsync(orderId).then(() => toast.show(p.copied, 'info'));
  };
  const tile = (name: keyof typeof Ionicons.glyphMap) => (
    <RowTile tint={theme.color.brandSoft}>
      <Ionicons name={name} size={iconSize.lg} color={theme.color.brand} />
    </RowTile>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.bg }}>
      <PlainHeader title={p.title} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance,
          gap: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        {status === null ? (
          <EmptyState
            title={p.emptyTitle}
            body={p.emptyBody}
            icon={<Ionicons name="receipt-outline" size={iconSize.xxl} color={theme.color.brand} />}
            action={<Button label={p.seePlans} onPress={() => router.push('/settings/upgrade')} />}
          />
        ) : (
          <StandardCard style={{ gap: theme.spacing.sm }}>
            <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
              <Text style={{ flex: 1, fontWeight: '800', fontSize: 17 }} numberOfLines={1}>
                {isYearly(ent, row) ? p.proYearly : p.proMonthly}
              </Text>
              {ent?.isSandbox ? (
                <Text variant="micro" tone="muted" style={{ fontWeight: '700' }}>
                  {p.test}
                </Text>
              ) : null}
              <Badge label={p.status[status]} tone={PILL_TONE[status]} />
            </Row>
            {priceLine ? <Text tone="muted">{priceLine}</Text> : null}
            {dateLine ? (
              <Text variant="caption" tone="muted">
                {dateLine}
              </Text>
            ) : null}
            {status === 'expired' || status === 'refunded' ? (
              <Button label={p.seePlans} onPress={() => router.push('/settings/upgrade')} />
            ) : kind !== 'none' ? (
              // Plans are switched in the store, so Manage is also "Change plan".
              <Button
                label={t.upgradeScreen.manageSubscription}
                variant="secondary"
                disabled={wrongPlatform}
                onPress={onManage}
              />
            ) : null}
            {wrongPlatform ? (
              <Text variant="micro" tone="muted">
                {kind === 'play' ? p.manageOnAndroid : p.manageOnIphone}
              </Text>
            ) : null}
          </StandardCard>
        )}

        {status !== null ? (
          <Text variant="micro" tone="muted">
            {receiptStore === 'apple' ? p.receiptsNoteApple : p.receiptsNotePlay}
          </Text>
        ) : null}

        <SectionHeader title={p.help} />
        <StandardCard style={{ paddingVertical: theme.spacing.xs }}>
          {status !== null ? (
            <ListRow
              leading={tile('receipt-outline')}
              title={p.getReceipt}
              divider
              onPress={() => void Linking.openURL(RECEIPT_URL[receiptStore])}
            />
          ) : null}
          <ListRow
            leading={tile('refresh-outline')}
            title={restoring ? t.paywall.restoring : t.paywall.restore}
            divider={status !== null}
            onPress={restoring ? undefined : () => void onRestore()}
          />
          {status !== null ? (
            <>
              {orderId ? (
                <ListRow
                  leading={tile('copy-outline')}
                  title={p.orderId}
                  subtitle={orderId}
                  divider
                  onPress={copyOrder}
                />
              ) : null}
              <ListRow
                leading={tile('chatbubble-ellipses-outline')}
                title={p.contactSupport}
                onPress={() => router.push('/settings/feedback')}
              />
            </>
          ) : null}
        </StandardCard>
        {query.isError && !row ? (
          <Pressable accessibilityRole="button" onPress={() => void query.refetch()} hitSlop={8}>
            <Text variant="caption" tone="brand" align="center">
              {t.retry}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}
