/**
 * Choose your plan — the paywall, presented as a sheet.
 *
 * Free and Pro: one Pro card (monthly or yearly), sold through RevenueCat. The
 * card comes from RevenueCat's current offering
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
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image, Pressable, ScrollView, View } from 'react-native';
import type { PurchasesOffering } from 'react-native-purchases';

import {
  isPaidTier,
  PlanTier,
  PRO_DEVICE_LIMIT,
  PRO_MONTHLY_SCANS,
  VOICE_AGENT_PRO_MONTHLY,
} from '@waves/core';
import { directionalIcon, IconButton, iconSize, Screen, Text, useTheme } from '@waves/ui';

import { fill, plural, useStrings, type UiStrings } from '@/i18n';
import { router } from '@/lib/navigation';
import {
  chosenCard,
  ctaState,
  defaultSelectedTier,
  paywallEmptyReason,
  periodsInOffering,
  planCardsFromOffering,
  showUpgradeHero,
  yearlySavingsPercent,
  type PaidTier,
  type PlanCardModel,
  type PlanPeriod,
} from '@/lib/pricing';
import { useTrackPremiumViewed } from '@/lib/premiumViewed';
import { openLegal } from '@/lib/legal';
import { loadOffering, purchase, restore } from '@/lib/purchases';
import { useToast } from '@/lib/toast';
import { trialDaysLeft } from '@/lib/proTrial';
import { useEntitlement } from '@/lib/useEntitlement';
import { useProTrial } from '@/lib/useProTrial';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; offering: PurchasesOffering | null };

/** The lighter end of the hero badge's gradient, and the sparkles' tone. Fixed so both themes read. */
const BADGE_TINT = '#A58FFF';
const SPARKLE = '#F5B83D';
const PRO_TILE = require('../../assets/images/paywall/paywall-pro-tile.webp') as number;

function planName(t: UiStrings, _tier: PlanTier): string {
  return t.paywall.proTitle;
}

export default function PaywallScreen() {
  const theme = useTheme();
  const { t, language } = useStrings();
  const toast = useToast();
  const entitlement = useEntitlement();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [period, setPeriod] = useState<PlanPeriod>('monthly');
  const [selected, setSelected] = useState<PaidTier>(defaultSelectedTier());
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // Counts this screen being opened, once per mount.
  useTrackPremiumViewed('paywall');

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

  // On the automatic Pro trial the person has Pro but has not paid: the cards
  // treat them as Free, so Pro stays buyable ("Keep Pro"), and the Pro card
  // says how many days are left instead of "Current plan".
  const trial = useProTrial();
  const onTrial = trial !== null && entitlement.tier === PlanTier.Pro;
  const current = onTrial ? PlanTier.Free : entitlement.tier;
  const chosen = chosenCard(cards, selected);
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

  const cta = ctaState({ chosen, current, purchasing });
  const ctaLabel = !chosen
    ? fill(t.paywall.continueWith, { plan: t.paywall.proTitle })
    : onTrial && chosen.tier === PlanTier.Pro && cta.kind === 'continue'
      ? t.paywall.keepPro
      : cta.kind === 'current'
        ? fill(t.paywall.alreadySubscribed, { plan: planName(t, chosen.tier) })
        : cta.kind === 'busy'
          ? t.paywall.subscribing
          : fill(t.paywall.continueWith, { plan: planName(t, chosen.tier) });

  const heroTitle = showUpgradeHero(current) ? t.paywall.heroTitle : t.paywall.title;
  const emptyCopy =
    paywallEmptyReason(load.status === 'error') === 'network'
      ? t.paywall.unavailable
      : t.paywall.noPlans;

  return (
    <Screen edges={['top', 'bottom']}>
      <LinearGradient
        pointerEvents="none"
        colors={[theme.color.brandSoft, theme.color.bg]}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 360 }}
      />
      <View style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.xs }}>
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.lg,
          gap: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1, gap: theme.spacing.sm, paddingEnd: theme.spacing.xs }}>
            <Text
              accessibilityRole="header"
              style={{ fontSize: 26, lineHeight: 32, fontWeight: '800' }}
            >
              {heroTitle}
            </Text>
            <Text variant="caption" tone="muted">
              {t.paywall.heroSubtitle}
            </Text>
          </View>
          <HeroBadge />
        </View>

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
              {emptyCopy}
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
                trialDaysLeft={
                  onTrial && card.tier === PlanTier.Pro && trial ? trialDaysLeft(trial) : null
                }
                onPress={() => setSelected(card.tier)}
              />
            ))}
          </View>
        )}

        <Text variant="subheading" style={{ fontWeight: '800', marginTop: theme.spacing.xs }}>
          {t.paywall.freeTitle}
        </Text>
        <FreeCard />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t.paywall.redeemTitle}. ${t.paywall.redeemHint}`}
          onPress={() => router.push('/settings/redeem')}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.md,
            backgroundColor: theme.color.surface,
            borderRadius: theme.radius.lg,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Ionicons name="ticket-outline" size={26} color={theme.color.brand} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700' }} tone="brand">
              {t.paywall.redeemTitle}
            </Text>
            <Text variant="caption" tone="muted">
              {t.paywall.redeemHint}
            </Text>
          </View>
          <Ionicons
            name={directionalIcon('chevron-forward')}
            size={iconSize.md}
            color={theme.color.textMuted}
          />
        </Pressable>

        <Text variant="micro" tone="muted" align="center">
          {t.paywall.renewNote}
        </Text>
      </ScrollView>

      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.sm,
          paddingBottom: theme.spacing.sm,
          gap: theme.spacing.sm,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
          accessibilityState={{ disabled: cta.disabled, busy: purchasing }}
          disabled={cta.disabled}
          onPress={() => void buy()}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: theme.spacing.sm,
            height: 52,
            borderRadius: theme.radius.pill,
            backgroundColor: pressed ? theme.color.brandPressed : theme.color.brand,
            opacity: cta.disabled ? 0.5 : 1,
          })}
        >
          <Text tone="onBrand" style={{ fontSize: 17, fontWeight: '700' }}>
            {ctaLabel}
          </Text>
          {cta.kind === 'continue' ? (
            <Ionicons
              name={directionalIcon('arrow-forward')}
              size={iconSize.md}
              color={theme.color.onBrand}
            />
          ) : null}
        </Pressable>

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

        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            gap: theme.spacing.sm,
          }}
        >
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={t.paywall.terms}
            onPress={() => openLegal('terms', language)}
            hitSlop={8}
          >
            <Text variant="caption" tone="muted">
              {t.paywall.terms}
            </Text>
          </Pressable>
          <Text variant="caption" tone="muted">
            {'•'}
          </Text>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={t.paywall.privacy}
            onPress={() => openLegal('privacy', language)}
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
        backgroundColor: theme.color.surface,
        borderRadius: theme.radius.pill,
        padding: 4,
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
              justifyContent: 'center',
              gap: 8,
              minWidth: 110,
              paddingHorizontal: theme.spacing.md,
              paddingVertical: 8,
              borderRadius: theme.radius.pill,
              backgroundColor: active ? theme.color.brand : 'transparent',
            }}
          >
            <Text
              style={{
                fontWeight: '700',
                color: active ? theme.color.onBrand : theme.color.text,
              }}
            >
              {value === 'monthly' ? labels.monthly : labels.yearly}
            </Text>
            {value === 'yearly' && labels.save ? (
              <Text
                variant="caption"
                style={{
                  fontWeight: '700',
                  color: active ? theme.color.onBrand : theme.color.brand,
                  opacity: active ? 0.9 : 1,
                }}
              >
                {labels.save}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** A crisp, code-drawn badge: a brand-gradient disc, a white crown, three gold sparkles. */
function HeroBadge() {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: 104, height: 104, alignItems: 'center', justifyContent: 'center' }}
    >
      <View
        style={{
          width: 84,
          height: 84,
          borderRadius: 42,
          shadowColor: theme.color.brand,
          shadowOpacity: 0.4,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 6 },
          elevation: 8,
          backgroundColor: theme.color.brand,
        }}
      >
        <LinearGradient
          colors={[theme.color.brand, BADGE_TINT]}
          start={{ x: 0.1, y: 1 }}
          end={{ x: 0.9, y: 0 }}
          style={{
            flex: 1,
            borderRadius: 42,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1.5,
            borderColor: 'rgba(255,255,255,0.35)',
          }}
        >
          <MaterialCommunityIcons name="crown" size={42} color="#FFFFFF" />
        </LinearGradient>
      </View>
      <Ionicons
        name="sparkles"
        size={20}
        color={SPARKLE}
        style={{ position: 'absolute', top: 2, end: 6 }}
      />
      <Ionicons
        name="sparkles"
        size={13}
        color={SPARKLE}
        style={{ position: 'absolute', top: 24, start: 0 }}
      />
      <Ionicons
        name="sparkles"
        size={11}
        color={SPARKLE}
        style={{ position: 'absolute', bottom: 6, end: 2 }}
      />
    </View>
  );
}

/** One plan: icon tile, name and price, a radio, then what it includes. */
function PlanCard({
  card,
  active,
  current,
  trialDaysLeft: trialDays,
  onPress,
}: {
  card: PlanCardModel;
  active: boolean;
  current: boolean;
  /** Days left on the automatic Pro trial, for the Pro card while on it. */
  trialDaysLeft: number | null;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const pro = card.tier === PlanTier.Pro;
  const title = t.paywall.proTitle;
  const tagline = t.paywall.proTagline;
  const cadence = card.period === 'yearly' ? t.paywall.perYear : t.paywall.perMonth;
  const badge =
    trialDays !== null
      ? plural(locale, trialDays, t.paywall.trialBadge)
      : current
        ? t.paywall.currentPlan
        : pro
          ? t.paywall.proBadge
          : null;
  const features = [
    fill(t.paywall.featureScans, { scans: PRO_MONTHLY_SCANS }),
    fill(t.paywall.featureDevices, { devices: PRO_DEVICE_LIMIT }),
    t.paywall.featureTransfers,
    fill(t.paywall.featureVoice, { commands: VOICE_AGENT_PRO_MONTHLY }),
  ];

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${title}, ${card.priceString} ${cadence}. ${tagline}. ${features.join('. ')}`}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: theme.color.surface,
        borderRadius: theme.radius.lg,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        borderWidth: 1.5,
        borderColor: active ? theme.color.brand : 'transparent',
        opacity: pressed ? 0.95 : 1,
        gap: theme.spacing.sm,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        {pro ? (
          <Image source={PRO_TILE} style={{ width: 48, height: 48 }} />
        ) : (
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              backgroundColor: theme.color.brandSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="wallet-outline" size={24} color={theme.color.brand} />
          </View>
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
            <Text variant="heading" style={{ fontWeight: '800' }}>
              {title}
            </Text>
            {badge ? (
              <View
                style={{
                  backgroundColor: theme.color.brandSoft,
                  borderRadius: theme.radius.pill,
                  paddingHorizontal: theme.spacing.sm,
                  paddingVertical: 2,
                }}
              >
                <Text variant="micro" tone="brand" style={{ fontWeight: '700' }}>
                  {badge}
                </Text>
              </View>
            ) : null}
          </View>
          <Text variant="caption" tone="muted">
            {tagline}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
          <Text style={{ fontSize: 20, lineHeight: 26, fontWeight: '800' }}>
            {card.priceString}
          </Text>
          <Text variant="caption" tone="muted">
            {cadence}
          </Text>
        </View>
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            backgroundColor: active ? theme.color.brand : 'transparent',
            borderWidth: active ? 0 : 1.5,
            borderColor: theme.color.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {active ? <Ionicons name="checkmark" size={16} color={theme.color.onBrand} /> : null}
        </View>
      </View>

      <View style={{ height: 1, backgroundColor: theme.color.border }} />

      <View style={{ gap: 6 }}>
        {features.map((feature) => (
          <View
            key={feature}
            style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}
          >
            <View
              style={{
                width: 20,
                height: 20,
                borderRadius: 10,
                backgroundColor: theme.color.brand,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="checkmark" size={13} color={theme.color.onBrand} />
            </View>
            <Text style={{ flex: 1 }}>{feature}</Text>
          </View>
        ))}
      </View>
    </Pressable>
  );
}

/** "What stays free?": three things that never need a plan. */
function FreeCard() {
  const theme = useTheme();
  const { t } = useStrings();
  const items = [
    { icon: 'people-outline', tint: 'mint', label: t.paywall.freeGroups },
    { icon: 'document-text-outline', tint: 'sky', label: t.paywall.freeExpenses },
    { icon: 'pie-chart-outline', tint: 'pink', label: t.paywall.freeBalances },
  ] as const;
  return (
    <View
      style={{
        backgroundColor: theme.color.surface,
        borderRadius: theme.radius.lg,
        paddingVertical: theme.spacing.md,
        gap: theme.spacing.sm,
      }}
    >
      <View style={{ flexDirection: 'row' }}>
        {items.map((item, i) => (
          <View
            key={item.icon}
            style={{
              flex: 1,
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: theme.spacing.xs,
              borderStartWidth: i === 0 ? 0 : 1,
              borderStartColor: theme.color.border,
            }}
          >
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: theme.tint[item.tint].bg,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name={item.icon} size={20} color={theme.tint[item.tint].ink} />
            </View>
            <Text variant="caption" align="center" style={{ fontWeight: '700' }}>
              {item.label}
            </Text>
            <Text variant="micro" tone="muted" align="center">
              {t.paywall.alwaysFree}
            </Text>
          </View>
        ))}
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.spacing.xs,
          paddingHorizontal: theme.spacing.md,
        }}
      >
        <Ionicons name="mic-outline" size={16} color={theme.tint.lilac.ink} />
        <Text variant="caption" tone="muted" align="center">
          {t.paywall.freeVoice}
        </Text>
      </View>
    </View>
  );
}
