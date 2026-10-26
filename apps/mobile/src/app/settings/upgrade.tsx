/**
 * Simplified plan screen — two cards (Free and Pro), faithfully matching the
 * compact mockup layout. All purchase/restore/manage logic is unchanged.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useQueryClient } from '@tanstack/react-query';
import type { PurchasesOffering } from 'react-native-purchases';

import {
  FREE_MONTHLY_SCANS,
  isPaidTier,
  PRO_DEVICE_LIMIT,
  PRO_MONTHLY_SCANS,
  PlanTier,
  VOICE_AGENT_FREE_MONTHLY,
  VOICE_AGENT_PRO_MONTHLY,
} from '@waves/core';
import { iconSize, Row, Screen, Text, useTabBarClearance, useTheme } from '@waves/ui';

import { fill, useStrings } from '@/i18n';
import { RewardedAdEntry } from '@/components/RewardedAdEntry';
import { PlainHeader } from '@/components/standard/PlainHeader';
import { quietAdsFor } from '@/lib/adSensitiveMoment';
import { openLegal } from '@/lib/legal';
import { router } from '@/lib/navigation';
import { useTrackPremiumViewed } from '@/lib/premiumViewed';
import { useFlagEnabled } from '@/lib/flags';
import {
  chosenCard,
  defaultSelectedTier,
  periodsInOffering,
  planCardsFromOffering,
  yearlySavingsPercent,
  type PaidTier,
  type PlanPeriod,
} from '@/lib/pricing';
import {
  hasStoreSubscription,
  loadOffering,
  manageSubscription,
  purchase,
  purchasesAvailable,
  restore,
  useCustomerTier,
} from '@/lib/purchases';
import { reportHandled } from '@/lib/observability';
import { useToast } from '@/lib/toast';
import { useEntitlement } from '@/lib/useEntitlement';
import { useProTrial } from '@/lib/useProTrial';

const CROWN_ART = require('../../../assets/images/plan-crown.png') as number;

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; offering: PurchasesOffering | null };

export default function UpgradeScreen() {
  useEffect(() => {
    quietAdsFor();
    return () => quietAdsFor();
  }, []);
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, language } = useStrings();
  const toast = useToast();
  const entitlement = useEntitlement();
  const { info } = useCustomerTier();

  const plansLive = useFlagEnabled('paywall') && purchasesAvailable();
  // On the automatic Pro trial the person has Pro but has not paid, so Pro stays buyable.
  const trial = useProTrial();
  const isPaid = entitlement.isPaid && !(trial !== null && entitlement.tier === PlanTier.Pro);

  const [load, setLoad] = useState<LoadState>(() =>
    plansLive ? { status: 'loading' } : { status: 'ready', offering: null },
  );
  const [attempt, setAttempt] = useState(0);
  const [period, setPeriod] = useState<PlanPeriod>('monthly');
  const [selected] = useState<PaidTier>(defaultSelectedTier());
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useTrackPremiumViewed('upgrade');

  useEffect(() => {
    if (!plansLive) return;
    let active = true;
    loadOffering()
      .then((offering) => {
        if (!active) return;
        setLoad({ status: 'ready', offering });
      })
      .catch(() => {
        if (active) setLoad({ status: 'error' });
      });
    return () => {
      active = false;
    };
  }, [attempt, plansLive]);

  const offering = load.status === 'ready' ? load.offering : null;

  const periods = useMemo(() => periodsInOffering(offering), [offering]);
  const resolvedPeriod: PlanPeriod = useMemo(() => {
    if (periods.includes(period)) return period;
    return periods[0] ?? 'yearly';
  }, [period, periods]);

  const cards = useMemo(
    () => planCardsFromOffering(offering, resolvedPeriod),
    [offering, resolvedPeriod],
  );

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

  const chosen = chosenCard(cards, selected);
  const canManage = plansLive && hasStoreSubscription(info);

  const queryClient = useQueryClient();

  const buy = useCallback(async () => {
    if (!chosen || purchasing || !offering) return;
    if (isPaid) return;
    const pkg = offering.availablePackages.find((p) => p.identifier === chosen.packageId);
    if (!pkg) return;
    setPurchasing(true);
    try {
      const outcome = await purchase(pkg);
      if (outcome === 'purchased') {
        void queryClient.invalidateQueries({ queryKey: ['voiceAgentEnabled'] });
        toast.show(fill(t.paywall.purchased, { plan: t.paywall.proTitle }), 'positive');
        router.back();
      } else if (outcome === 'pending') {
        toast.show(t.paywall.purchasePending, 'info');
      }
    } catch {
      toast.show(t.paywall.genericError, 'negative');
    } finally {
      setPurchasing(false);
    }
  }, [chosen, purchasing, offering, isPaid, toast, t, queryClient]);

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

  const onManage = () => {
    manageSubscription().catch((error: unknown) => {
      reportHandled(error, 'purchases.manageSubscription');
      toast.show(t.paywall.genericError, 'negative');
    });
  };

  const periodLabel = resolvedPeriod === 'yearly' ? t.paywall.perYear : t.paywall.perMonth;
  const ctaLabel = isPaid
    ? t.planScreen.alreadyPro
    : purchasing
      ? t.paywall.subscribing
      : chosen
        ? fill(t.planScreen.ctaGetPro, { price: chosen.priceString, period: periodLabel })
        : fill(t.planScreen.ctaGetPro, { price: '—', period: periodLabel });

  const ctaDisabled = isPaid || purchasing || !chosen || !plansLive;

  // Free card features
  const freeFeatures: { text: string; dimmed?: boolean }[] = [
    { text: t.planScreen.freeFeatureExpenses },
    { text: t.planScreen.freeFeatureBalances },
    { text: fill(t.planScreen.freeFeatureScans, { scans: FREE_MONTHLY_SCANS }) },
    { text: fill(t.planScreen.freeFeatureVoice, { commands: VOICE_AGENT_FREE_MONTHLY }) },
    { text: t.planScreen.freeFeatureAds, dimmed: true },
  ];

  // Pro card features
  const proFeatures: { text: string; aiPill?: boolean }[] = [
    { text: t.planScreen.proFeatureNoAds },
    { text: fill(t.planScreen.proFeatureScans, { scans: PRO_MONTHLY_SCANS }) },
    { text: fill(t.planScreen.proFeatureVoice, { commands: VOICE_AGENT_PRO_MONTHLY }) },
    { text: t.assistant.planRowTitle, aiPill: true },
    ...(PRO_DEVICE_LIMIT > 1
      ? [{ text: fill(t.planScreen.proFeatureDevices, { devices: PRO_DEVICE_LIMIT }) }]
      : []),
  ];

  return (
    // PlainHeader already supplies the top safe-area inset.
    <Screen edges={Platform.OS === 'android' ? ['bottom'] : ['top', 'bottom']}>
      <PlainHeader title={t.planScreen.title} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: Platform.OS === 'android' ? theme.spacing.sm : 0,
          paddingBottom: Platform.OS === 'android' ? clearance : theme.spacing.lg,
          gap: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        <RewardedAdEntry kind="voice" />
        <RewardedAdEntry kind="scan" />
        {/* ── Hero row ──────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <View style={{ flex: 1, gap: 6 }}>
            <Text
              style={{
                color: theme.color.brand,
                fontSize: 10,
                fontWeight: '700',
                letterSpacing: 1.2,
                textTransform: 'uppercase',
              }}
            >
              {t.planScreen.heroEyebrow}
            </Text>
            <Text style={{ fontSize: 22, fontWeight: '800', lineHeight: 28 }} numberOfLines={2}>
              {t.planScreen.heroTitle}
            </Text>
            <Text variant="caption" tone="muted">
              {t.planScreen.heroBody}
            </Text>
          </View>
          <Image
            source={CROWN_ART}
            style={{ width: 130, height: 118, resizeMode: 'contain' }}
            accessibilityIgnoresInvertColors
          />
        </View>

        {/* ── Free card ─────────────────────────────────────────────── */}
        <View
          style={{
            backgroundColor: theme.color.surface,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: theme.color.border,
            padding: theme.spacing.md,
            gap: theme.spacing.sm,
          }}
        >
          {/* Card header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 14,
                backgroundColor: theme.color.brandSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="wallet-outline" size={26} color={theme.color.brand} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                <Text style={{ fontWeight: '800', fontSize: 17, flex: 1 }}>Free</Text>
                {!isPaid ? (
                  <View
                    style={{
                      backgroundColor: theme.color.brandSoft,
                      borderRadius: theme.radius.pill,
                      paddingHorizontal: theme.spacing.sm,
                      paddingVertical: 2,
                    }}
                  >
                    <Text variant="micro" tone="brand" style={{ fontWeight: '700' }}>
                      {t.paywall.currentPlan}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text variant="caption" tone="muted">
                {t.planScreen.freePrice}
              </Text>
              <Text variant="caption" tone="muted">
                {t.planScreen.freeCaption}
              </Text>
            </View>
          </View>

          <View style={{ height: 1, backgroundColor: theme.color.border }} />

          {/* Feature list */}
          <View style={{ gap: 8 }}>
            {freeFeatures.map((feat) => (
              <View
                key={feat.text}
                style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}
              >
                <View
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    backgroundColor: feat.dimmed ? theme.color.surfaceMuted : theme.color.brand,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons
                    name={feat.dimmed ? 'remove' : 'checkmark'}
                    size={13}
                    color={feat.dimmed ? theme.color.textMuted : theme.color.onBrand}
                  />
                </View>
                <Text
                  variant="caption"
                  style={{
                    flex: 1,
                    color: feat.dimmed ? theme.color.textMuted : theme.color.text,
                  }}
                >
                  {feat.text}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Pro card ──────────────────────────────────────────────── */}
        <View
          style={{
            borderRadius: 20,
            borderWidth: 1.5,
            borderColor: theme.color.brand,
            overflow: 'hidden',
            shadowColor: '#2A1E6B',
            shadowOpacity: theme.scheme !== 'dark' ? 0.1 : 0,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 4 },
            // Android elevation leaves a box behind the translucent gradient.
            elevation: Platform.OS === 'android' ? 0 : 3,
          }}
        >
          <LinearGradient
            colors={[`${theme.color.brand}18`, `${theme.color.brand}08`, 'transparent'] as const}
            style={{ padding: theme.spacing.md, gap: theme.spacing.sm }}
          >
            {/* Card header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  backgroundColor: theme.color.brand,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <MaterialCommunityIcons name="crown" size={26} color={theme.color.onBrand} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                  <Text style={{ fontWeight: '800', fontSize: 17 }}>Pro</Text>
                  {chosen && !isPaid ? (
                    <Text variant="caption" tone="muted">
                      {chosen.priceString}
                      {periodLabel}
                    </Text>
                  ) : null}
                  {isPaid ? (
                    <View style={{ flex: 1, alignItems: 'flex-end' }}>
                      <View
                        style={{
                          backgroundColor: theme.color.brandSoft,
                          borderRadius: theme.radius.pill,
                          paddingHorizontal: theme.spacing.sm,
                          paddingVertical: 2,
                        }}
                      >
                        <Text variant="micro" tone="brand" style={{ fontWeight: '700' }}>
                          {t.paywall.currentPlan}
                        </Text>
                      </View>
                    </View>
                  ) : null}
                </View>
                <Text variant="caption" tone="muted">
                  {t.planScreen.proCardSubtitle}
                </Text>
              </View>
            </View>

            {load.status === 'loading' ? (
              <Text
                variant="caption"
                tone="muted"
                align="center"
                style={{ marginTop: theme.spacing.sm }}
              >
                {t.paywall.loading}
              </Text>
            ) : load.status === 'error' ? (
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
              <>
                <View style={{ height: 1, backgroundColor: theme.color.brand, opacity: 0.15 }} />

                {/* Feature list */}
                <View style={{ gap: 8 }}>
                  {proFeatures.map((feat) => (
                    <View
                      key={feat.text}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: theme.spacing.sm,
                      }}
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
                      <Text variant="caption" style={{ flex: 1 }}>
                        {feat.text}
                      </Text>
                      {feat.aiPill && t.assistant.planRowPill ? (
                        <View
                          style={{
                            backgroundColor: theme.color.brandSoft,
                            borderRadius: theme.radius.pill,
                            paddingHorizontal: 6,
                            paddingVertical: 1,
                          }}
                        >
                          <Text variant="micro" tone="brand" style={{ fontWeight: '700' }}>
                            {t.assistant.planRowPill}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  ))}
                </View>

                {/* Period toggle inside the card (compact, only when both periods available) */}
                {plansLive && periods.length > 1 ? (
                  <PeriodToggle
                    period={resolvedPeriod}
                    periods={periods}
                    savings={savings}
                    onChange={setPeriod}
                  />
                ) : null}

                {/* CTA button */}
                {isPaid ? (
                  <View style={{ alignItems: 'center', gap: theme.spacing.xs }}>
                    <Text style={{ fontWeight: '700', fontSize: 17 }}>
                      {t.planScreen.alreadyPro}
                    </Text>
                    {canManage ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t.upgradeScreen.manageSubscription}
                        onPress={onManage}
                        hitSlop={8}
                      >
                        <Text tone="brand" style={{ fontWeight: '600' }}>
                          {t.upgradeScreen.manageSubscription}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : plansLive ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={ctaLabel}
                    accessibilityState={{ disabled: ctaDisabled, busy: purchasing }}
                    disabled={ctaDisabled}
                    onPress={() => void buy()}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: theme.spacing.sm,
                      height: 52,
                      borderRadius: theme.radius.pill,
                      backgroundColor: pressed ? theme.color.brandPressed : theme.color.brand,
                      opacity: ctaDisabled ? 0.5 : 1,
                    })}
                  >
                    {!purchasing ? (
                      <MaterialCommunityIcons
                        name="crown"
                        size={iconSize.md}
                        color={theme.color.onBrand}
                      />
                    ) : null}
                    <Text tone="onBrand" style={{ fontSize: 17, fontWeight: '700' }}>
                      {purchasing ? t.paywall.subscribing : 'Upgrade to Pro'}
                    </Text>
                  </Pressable>
                ) : null}
              </>
            )}
          </LinearGradient>
        </View>

        {/* ── Renewal note ──────────────────────────────────────────── */}
        {plansLive && !isPaid ? (
          <Text variant="micro" tone="muted" align="center">
            {t.paywall.renewNote}
          </Text>
        ) : null}
      </ScrollView>

      {/* ── Small links row ─────────────────────────────────────────── */}
      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.sm,
          paddingBottom: theme.spacing.md,
        }}
      >
        <Row style={{ alignItems: 'center', justifyContent: 'center', gap: theme.spacing.md }}>
          {plansLive && !isPaid ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={restoring ? t.paywall.restoring : t.paywall.restore}
                accessibilityState={{ disabled: restoring }}
                disabled={restoring}
                onPress={() => void onRestore()}
                hitSlop={8}
              >
                <Text variant="caption" tone="brand" style={{ opacity: restoring ? 0.6 : 1 }}>
                  {restoring ? t.paywall.restoring : t.paywall.restore}
                </Text>
              </Pressable>
              <Text variant="caption" tone="muted">
                {'·'}
              </Text>
            </>
          ) : null}
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
            {'·'}
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
          <Text variant="caption" tone="muted">
            {'·'}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.planScreen.haveCode}
            onPress={() => router.push('/settings/redeem')}
            hitSlop={8}
          >
            <Text variant="caption" tone="brand">
              {t.planScreen.haveCode}
            </Text>
          </Pressable>
        </Row>
      </View>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// PeriodToggle sub-component (compact version for inside Pro card)
// ---------------------------------------------------------------------------

function PeriodToggle({
  period,
  periods,
  savings,
  onChange,
}: {
  period: PlanPeriod;
  periods: PlanPeriod[];
  savings: number;
  onChange: (p: PlanPeriod) => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        alignSelf: 'stretch',
        backgroundColor: `${theme.color.brand}10`,
        borderRadius: theme.radius.pill,
        padding: 3,
      }}
    >
      {periods.map((value) => {
        const active = period === value;
        const label = value === 'monthly' ? t.paywall.monthlyTab : t.paywall.yearlyTab;
        const savePill =
          value === 'yearly' && savings > 0
            ? fill(t.paywall.yearlySave, { percent: savings })
            : null;
        return (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(value)}
            style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingHorizontal: theme.spacing.sm,
              paddingVertical: 7,
              borderRadius: theme.radius.pill,
              backgroundColor: active ? theme.color.brand : 'transparent',
            }}
          >
            <Text
              style={{
                fontWeight: '700',
                fontSize: 13,
                color: active ? theme.color.onBrand : theme.color.text,
              }}
            >
              {label}
            </Text>
            {savePill ? (
              <Text
                variant="micro"
                style={{
                  fontWeight: '700',
                  color: active ? theme.color.onBrand : theme.color.brand,
                  opacity: active ? 0.9 : 1,
                }}
              >
                {savePill}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
