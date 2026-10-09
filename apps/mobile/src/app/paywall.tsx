/**
 * Choose your plan — the paywall, presented as a sheet.
 *
 * Plus (the paid features without the advanced AI voice) and Pro (everything),
 * sold through RevenueCat. The cards come from RevenueCat's current offering
 * ('default'), so every price on screen is the store's own localized string —
 * nothing here is hardcoded. A monthly/yearly switch appears only once the
 * offering sells yearly plans.
 *
 * Reachable only behind the `paywall` flag AND on a build with a RevenueCat key
 * (see `_layout.tsx`). What a purchase unlocks is decided by the server, from
 * `subscriptions`, which RevenueCat's webhook writes; the "current plan" shown
 * here is RevenueCat's CustomerInfo, for display only.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';
import type { PurchasesOffering } from 'react-native-purchases';

import {
  isPaidTier,
  PlanTier,
  PLUS_DEVICE_LIMIT,
  PLUS_MONTHLY_SCANS,
  VOICE_AGENT_PRO_MONTHLY,
} from '@waves/core';
import { Button, IconButton, iconSize, Screen, Text, useTheme } from '@waves/ui';

import { fill, useStrings, type UiStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import {
  periodsInOffering,
  planCardsFromOffering,
  yearlySavingsPercent,
  type PaidTier,
  type PlanCardModel,
  type PlanPeriod,
} from '@/lib/pricing';
import { loadOffering, purchase, restore } from '@/lib/purchases';
import { useToast } from '@/lib/toast';
import { useEntitlement } from '@/lib/useEntitlement';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; offering: PurchasesOffering | null };

function planName(t: UiStrings, tier: PlanTier): string {
  return tier === PlanTier.Pro ? t.paywall.proTitle : t.paywall.plusTitle;
}

export default function PaywallScreen() {
  const theme = useTheme();
  const { t } = useStrings();
  const toast = useToast();
  const entitlement = useEntitlement();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [period, setPeriod] = useState<PlanPeriod>('monthly');
  const [selected, setSelected] = useState<PaidTier>(PlanTier.Pro);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    let active = true;
    loadOffering()
      .then((offering) => active && setLoad({ status: 'ready', offering }))
      .catch(() => active && setLoad({ status: 'error' }));
    return () => {
      active = false;
    };
  }, [attempt]);

  const offering = load.status === 'ready' ? load.offering : null;
  const periods = useMemo(() => periodsInOffering(offering), [offering]);
  const cards = useMemo(() => planCardsFromOffering(offering, period), [offering, period]);
  const savings = useMemo(() => {
    const monthly = planCardsFromOffering(offering, 'monthly');
    const yearly = planCardsFromOffering(offering, 'yearly');
    const best = Math.max(
      0,
      ...yearly.map((card) => {
        const match = monthly.find((m) => m.tier === card.tier);
        return match ? yearlySavingsPercent(match.price, card.price) : 0;
      }),
    );
    return best;
  }, [offering]);

  const current = entitlement.tier;
  const chosen = cards.find((card) => card.tier === selected) ?? cards[cards.length - 1];
  const chosenIsCurrent = chosen ? chosen.tier === current : false;

  const queryClient = useQueryClient();
  const buy = useCallback(async () => {
    if (!chosen || purchasing || chosenIsCurrent || !offering) return;
    const pkg = offering.availablePackages.find((p) => p.identifier === chosen.packageId);
    if (!pkg) return;
    setPurchasing(true);
    try {
      const outcome = await purchase(pkg);
      if (outcome === 'purchased') {
        void queryClient.invalidateQueries({ queryKey: ['voiceAgentEnabled'] });
        toast.show(fill(t.paywall.purchased, { plan: planName(t, chosen.tier) }), 'positive');
        router.back();
      } else if (outcome === 'pending') {
        toast.show(t.paywall.purchasePending, 'info');
      }
    } catch {
      toast.show(t.paywall.genericError, 'negative');
    } finally {
      setPurchasing(false);
    }
  }, [chosen, purchasing, chosenIsCurrent, offering, toast, t, queryClient]);

  const onRestore = useCallback(async () => {
    setRestoring(true);
    try {
      const tier = await restore();
      void queryClient.invalidateQueries({ queryKey: ['voiceAgentEnabled'] });
      const found = isPaidTier(tier);
      toast.show(
        found ? t.paywall.restoredSuccess : t.paywall.restoredNothing,
        found ? 'positive' : 'info',
      );
    } catch {
      toast.show(t.paywall.genericError, 'negative');
    } finally {
      setRestoring(false);
    }
  }, [toast, t, queryClient]);

  const cta = !chosen
    ? fill(t.paywall.subscribe, { plan: t.paywall.proTitle })
    : chosenIsCurrent
      ? fill(t.paywall.alreadySubscribed, { plan: planName(t, chosen.tier) })
      : purchasing
        ? t.paywall.subscribing
        : fill(t.paywall.subscribe, { plan: planName(t, chosen.tier) });

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
          paddingTop: theme.spacing.sm,
          paddingBottom: theme.spacing.lg,
          gap: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        {periods.length > 1 ? (
          <PeriodSwitch
            period={period}
            onChange={setPeriod}
            labels={{
              monthly: t.paywall.monthlyTab,
              yearly: t.paywall.yearlyTab,
              save: savings > 0 ? fill(t.paywall.yearlySave, { percent: savings }) : null,
            }}
          />
        ) : null}

        {load.status === 'loading' ? (
          <Text variant="caption" tone="muted" align="center">
            {t.paywall.loading}
          </Text>
        ) : load.status === 'error' || cards.length === 0 ? (
          <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
            <Text variant="caption" tone="muted" align="center">
              {t.paywall.unavailable}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setLoad({ status: 'loading' });
                setAttempt((n) => n + 1);
              }}
              hitSlop={8}
            >
              <Text tone="brand" style={{ fontWeight: '700' }}>
                {t.paywall.retry}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View accessibilityRole="radiogroup" style={{ gap: theme.spacing.sm }}>
            {cards.map((card) => (
              <PlanCard
                key={card.packageId}
                card={card}
                active={chosen?.packageId === card.packageId}
                current={card.tier === current}
                onPress={() => setSelected(card.tier)}
              />
            ))}
          </View>
        )}

        <Text variant="caption" tone="muted" align="center">
          {t.paywall.renewNote}
        </Text>
      </ScrollView>

      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.sm,
          paddingBottom: theme.spacing.md,
          gap: theme.spacing.sm,
        }}
      >
        <Button
          label={cta}
          variant="brand"
          size="lg"
          fullWidth
          disabled={!chosen || chosenIsCurrent || purchasing}
          onPress={() => void buy()}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={restoring ? t.paywall.restoring : t.paywall.restore}
          accessibilityState={{ disabled: restoring }}
          disabled={restoring}
          onPress={() => void onRestore()}
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

/** Monthly | Yearly, shown only once the offering sells both. */
function PeriodSwitch({
  period,
  onChange,
  labels,
}: {
  period: PlanPeriod;
  onChange: (period: PlanPeriod) => void;
  labels: { monthly: string; yearly: string; save: string | null };
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        alignSelf: 'center',
        backgroundColor: theme.color.surfaceMuted,
        borderRadius: theme.radius.pill,
        padding: 3,
      }}
    >
      {(['monthly', 'yearly'] as const).map((value) => {
        const active = period === value;
        return (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(value)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: theme.spacing.md,
              paddingVertical: 6,
              borderRadius: theme.radius.pill,
              backgroundColor: active ? theme.color.surface : 'transparent',
            }}
          >
            <Text variant="caption" style={{ fontWeight: active ? '700' : '500' }}>
              {value === 'monthly' ? labels.monthly : labels.yearly}
            </Text>
            {value === 'yearly' && labels.save ? (
              <Text variant="micro" tone="brand" style={{ fontWeight: '800' }}>
                {labels.save}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** One plan, in the brand's purple. */
function PlanCard({
  card,
  active,
  current,
  onPress,
}: {
  card: PlanCardModel;
  active: boolean;
  current: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const pro = card.tier === PlanTier.Pro;
  const title = pro ? t.paywall.proTitle : t.paywall.plusTitle;
  const tagline = pro ? t.paywall.proTagline : t.paywall.plusTagline;
  const cadence = card.period === 'yearly' ? t.paywall.perYear : t.paywall.perMonth;
  const badge = current ? t.paywall.currentPlan : pro ? t.paywall.proBadge : null;
  const features = pro
    ? [
        t.paywall.featureEverythingPlus,
        fill(t.paywall.featureVoice, { commands: VOICE_AGENT_PRO_MONTHLY }),
      ]
    : [
        fill(t.paywall.featureScans, { scans: PLUS_MONTHLY_SCANS }),
        fill(t.paywall.featureDevices, { devices: PLUS_DEVICE_LIMIT }),
        t.paywall.featureTransfers,
      ];

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${title}, ${card.priceString} ${cadence}. ${tagline}. ${features.join('. ')}`}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: active ? theme.color.brandSoft : theme.color.surface,
        borderRadius: theme.radius.lg,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.md,
        borderWidth: 2,
        borderColor: active ? theme.color.brand : theme.color.border,
        opacity: pressed ? 0.95 : 1,
        gap: 6,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Text variant="subheading" style={{ fontWeight: '800' }}>
          {title}
        </Text>
        {badge ? (
          <View
            style={{
              backgroundColor: current ? theme.color.positive : theme.color.brand,
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
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
          <Text style={{ fontSize: 22, fontWeight: '800', color: theme.color.text }}>
            {card.priceString}
          </Text>
          <Text variant="caption" tone="muted">
            {cadence}
          </Text>
        </View>
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

      <Text variant="caption" tone="muted">
        {tagline}
      </Text>

      <View style={{ gap: 2 }}>
        {features.map((feature) => (
          <View key={feature} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="checkmark-circle" size={14} color={theme.color.brand} />
            <Text variant="caption" style={{ flex: 1 }}>
              {feature}
            </Text>
          </View>
        ))}
      </View>
    </Pressable>
  );
}
