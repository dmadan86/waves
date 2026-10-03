/**
 * Choose your plan — the paywall, presented as a sheet.
 *
 * Wired to the store: `expo-iap`'s `useIAP()` fetches the real, localized
 * prices for `waves_pro_monthly` and `waves_pro_yearly` the moment it
 * connects, and Subscribe / Restore go through the platform's own purchase
 * sheet. The regional price table in `@/lib/pricing` is shown only when the
 * store has not answered yet (no connection — a dev build, a simulator, a
 * network blip) — marked "approximate" on screen, and never the number an
 * actual purchase charges.
 *
 * NOTE — still behind the `paywall` route flag and still not reconciled with
 * `settings/upgrade`, which says there is nothing to buy. That reconciliation
 * (point upgrade here, or keep this behind the flag indefinitely) is a
 * product decision for whoever owns it, not something this change makes.
 *
 * Receipts are not verified server-side yet. `useEntitlement`'s doc comment
 * and docs/pricing.md both say so — nothing here, or anywhere downstream,
 * should treat a purchase on this screen as proof of anything
 * security-sensitive until that lands.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ErrorCode, getUserFriendlyErrorMessage, isUserCancelledError, useIAP } from 'expo-iap';
import { Pressable, ScrollView, View } from 'react-native';

import { Button, IconButton, iconSize, Screen, Text, useTheme } from '@waves/ui';

import { deviceCountry, fill, useStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import {
  entitlementFromActiveSubscriptions,
  fallbackPriceFor,
  formatApproxMoney,
  freeMonthsForYearly,
  monthlyEquivalent,
  MONTHLY_PRODUCT_ID,
  PRO_PRODUCT_IDS,
  YEARLY_PRODUCT_ID,
  YEARLY_TRIAL_DAYS,
  type ProPlanId,
} from '@/lib/pricing';
import { useToast } from '@/lib/toast';

const SUBSCRIPTION_SKUS = [MONTHLY_PRODUCT_ID, YEARLY_PRODUCT_ID];

/** One plan's price, however it was sourced. Only ever used for display and
 *  for the savings/per-month math below — the purchase itself always goes
 *  through the store by product id, never by this number. */
interface PlanPrice {
  display: string;
  amount: number;
  fromStore: boolean;
}

export default function PaywallScreen() {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const toast = useToast();
  const [selected, setSelected] = useState<ProPlanId>('yearly');
  const [purchasing, setPurchasing] = useState<ProPlanId | null>(null);
  const [restoring, setRestoring] = useState(false);

  const {
    connected,
    subscriptions,
    activeSubscriptions,
    fetchProducts,
    requestPurchase,
    restorePurchases,
    finishTransaction,
    hasActiveSubscriptions,
  } = useIAP();

  useEffect(() => {
    if (!connected) return;
    void fetchProducts({ skus: SUBSCRIPTION_SKUS, type: 'subs' });
  }, [connected, fetchProducts]);

  const country = useMemo(() => deviceCountry(), []);
  const fallback = useMemo(() => fallbackPriceFor(country), [country]);

  const priceFor = useCallback(
    (plan: ProPlanId): PlanPrice => {
      const productId = PRO_PRODUCT_IDS[plan];
      const product = subscriptions.find((sub) => sub.id === productId);
      if (product?.price != null) {
        return { display: product.displayPrice, amount: product.price, fromStore: true };
      }
      const amount = plan === 'monthly' ? fallback.monthly : fallback.yearly;
      return {
        display: formatApproxMoney(amount, fallback.currency, locale),
        amount,
        fromStore: false,
      };
    },
    [subscriptions, fallback, locale],
  );

  const monthlyPrice = priceFor('monthly');
  const yearlyPrice = priceFor('yearly');
  const bothFromStore = monthlyPrice.fromStore && yearlyPrice.fromStore;

  // The "2 months free" / per-month maths only mean something when both
  // numbers are in the same currency. When the store has only answered for
  // one plan, compare the fallback pair instead of two different storefronts'
  // numbers against each other.
  const comparison = bothFromStore
    ? { monthly: monthlyPrice.amount, yearly: yearlyPrice.amount }
    : { monthly: fallback.monthly, yearly: fallback.yearly };
  const freeMonths = freeMonthsForYearly(comparison.monthly, comparison.yearly);
  const perMonthDisplay = formatApproxMoney(
    monthlyEquivalent(yearlyPrice.amount),
    bothFromStore
      ? (subscriptions.find((sub) => sub.id === YEARLY_PRODUCT_ID)?.currency ?? fallback.currency)
      : fallback.currency,
    locale,
  );

  const entitlement = useMemo(
    () => entitlementFromActiveSubscriptions(activeSubscriptions),
    [activeSubscriptions],
  );

  const buy = useCallback(
    async (plan: ProPlanId) => {
      if (entitlement.isPro || purchasing) return;
      const productId = PRO_PRODUCT_IDS[plan];
      setPurchasing(plan);
      try {
        const androidOffer = subscriptions.find(
          (sub) => sub.id === productId && sub.platform === 'android',
        )?.subscriptionOffers?.[0];
        const result = await requestPurchase({
          type: 'subs',
          request: {
            apple: { sku: productId },
            google: {
              skus: [productId],
              subscriptionOffers: androidOffer?.offerTokenAndroid
                ? [{ sku: productId, offerToken: androidOffer.offerTokenAndroid }]
                : undefined,
            },
          },
        });

        const purchases = Array.isArray(result) ? result : result ? [result] : [];
        for (const purchase of purchases) {
          // No backend to verify the receipt against yet (see the file doc
          // comment), so the purchase is finished as soon as the store
          // confirms it, rather than left in the queue waiting on a check
          // that does not exist. Revisit once server-side verification lands.
          await finishTransaction({ purchase, isConsumable: false });
        }
        if (purchases.length > 0) router.back();
      } catch (error) {
        const purchaseError = error as { code?: ErrorCode; message?: string };
        if (isUserCancelledError(error)) {
          // A closed purchase sheet is not a failure worth a message.
        } else if (purchaseError.code === ErrorCode.Pending) {
          toast.show(t.paywall.purchasePending, 'info');
        } else {
          toast.show(
            getUserFriendlyErrorMessage(purchaseError) || t.paywall.genericError,
            'negative',
          );
        }
      } finally {
        setPurchasing(null);
      }
    },
    [entitlement.isPro, purchasing, requestPurchase, subscriptions, finishTransaction, toast, t],
  );

  const restore = useCallback(async () => {
    setRestoring(true);
    try {
      await restorePurchases();
      const owns = await hasActiveSubscriptions(SUBSCRIPTION_SKUS);
      toast.show(
        owns ? t.paywall.restoredSuccess : t.paywall.restoredNothing,
        owns ? 'positive' : 'info',
      );
    } catch {
      toast.show(t.paywall.genericError, 'negative');
    } finally {
      setRestoring(false);
    }
  }, [restorePurchases, hasActiveSubscriptions, toast, t]);

  const trialLine =
    selected === 'yearly'
      ? fill(t.paywall.trialLine, { days: YEARLY_TRIAL_DAYS, price: yearlyPrice.display })
      : fill(t.paywall.noTrialLine, { price: monthlyPrice.display });

  return (
    <Screen edges={['top', 'bottom']}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.sm,
        }}
      >
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons name="close" size={iconSize.lg} color={theme.color.text} />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="heading">{t.paywall.title}</Text>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.md,
          paddingBottom: theme.spacing.xl,
          gap: theme.spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        {entitlement.isPro ? (
          <View
            style={{
              backgroundColor: theme.color.brandSoft,
              borderRadius: theme.radius.md,
              padding: theme.spacing.md,
            }}
          >
            <Text variant="body" tone="brand" style={{ fontWeight: '700' }}>
              {t.paywall.alreadySubscribed}
            </Text>
          </View>
        ) : null}

        <View accessibilityRole="radiogroup" style={{ gap: theme.spacing.md }}>
          <PlanCard
            active={selected === 'yearly'}
            badge={fill(t.paywall.yearlyBadge, { months: freeMonths })}
            title={t.paywall.yearlyTitle}
            price={yearlyPrice.display}
            cadence="/yr"
            note={fill(t.paywall.perMonthEquivalent, { price: perMonthDisplay })}
            onPress={() => setSelected('yearly')}
          />
          <PlanCard
            active={selected === 'monthly'}
            title={t.paywall.monthlyTitle}
            price={monthlyPrice.display}
            cadence="/mo"
            note={t.paywall.monthlySubtitle}
            onPress={() => setSelected('monthly')}
          />
        </View>

        {!bothFromStore ? (
          <Text variant="caption" tone="muted" align="center">
            {t.paywall.approxNote}
          </Text>
        ) : null}

        <Text variant="caption" tone="muted" align="center">
          {trialLine}
        </Text>
      </ScrollView>

      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.sm,
          paddingBottom: theme.spacing.md,
          gap: theme.spacing.md,
        }}
      >
        <Button
          label={
            entitlement.isPro
              ? t.paywall.alreadySubscribed
              : purchasing
                ? t.paywall.subscribing
                : t.paywall.subscribe
          }
          variant="brand"
          size="lg"
          fullWidth
          disabled={entitlement.isPro || purchasing !== null}
          onPress={() => void buy(selected)}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={restoring ? t.paywall.restoring : t.paywall.restore}
          accessibilityState={{ disabled: restoring }}
          disabled={restoring}
          onPress={() => void restore()}
          hitSlop={8}
          style={{ alignSelf: 'center' }}
        >
          <Text tone="brand" style={{ fontWeight: '700', opacity: restoring ? 0.6 : 1 }}>
            {restoring ? t.paywall.restoring : t.paywall.restore}
          </Text>
        </Pressable>

        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: theme.spacing.lg }}>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={t.paywall.terms}
            onPress={() => router.push('/settings/privacy')}
            hitSlop={8}
          >
            <Text variant="caption" tone="muted">
              {t.paywall.terms}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={t.paywall.privacy}
            onPress={() => router.push('/settings/privacy')}
            hitSlop={8}
          >
            <Text variant="caption" tone="muted">
              {t.paywall.privacy}
            </Text>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}

/** One plan, in the brand's purple rather than the old gold placeholder. */
function PlanCard({
  active,
  badge,
  title,
  price,
  cadence,
  note,
  onPress,
}: {
  active: boolean;
  badge?: string;
  title: string;
  price: string;
  cadence: string;
  note: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${badge ? `${badge}, ` : ''}${title}, ${price} ${cadence}. ${note}`}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: active ? theme.color.brandSoft : theme.color.surface,
        borderRadius: theme.radius.lg,
        padding: theme.spacing.lg,
        borderWidth: 2,
        borderColor: active ? theme.color.brand : theme.color.border,
        opacity: pressed ? 0.95 : 1,
        gap: theme.spacing.xs,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        {badge ? (
          <View
            style={{
              backgroundColor: theme.color.brand,
              borderRadius: theme.radius.pill,
              paddingHorizontal: theme.spacing.sm,
              paddingVertical: 2,
            }}
          >
            <Text variant="micro" tone="onBrand" style={{ fontWeight: '800' }}>
              {badge}
            </Text>
          </View>
        ) : null}
        <Text variant="subheading" style={{ fontWeight: '800', flex: 1 }}>
          {title}
        </Text>
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: active ? theme.color.positive : 'transparent',
            borderWidth: active ? 0 : 2,
            borderColor: theme.color.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {active ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.xs }}>
        <Text style={{ fontSize: 26, fontWeight: '800', color: theme.color.text }}>{price}</Text>
        <Text variant="caption" tone="muted">
          {cadence}
        </Text>
      </View>

      <Text variant="caption" tone="muted">
        {note}
      </Text>
    </Pressable>
  );
}
