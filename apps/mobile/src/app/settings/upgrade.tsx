/**
 * Simplified plan screen — the single place to understand what Waves costs.
 *
 * Two cards: Free (always, forever) and Pro (priced from RevenueCat). A small
 * Monthly / Yearly segmented toggle appears only when both periods are sold; if
 * only yearly exists it is selected automatically (fixing the blank-screen bug
 * where the default was monthly but no monthly card existed).
 *
 * One primary button: "Get Pro · ₹79/mo". When the person is already on Pro it
 * becomes "You're on Pro" with a Manage subscription link. When the offering
 * has not loaded yet a loading state is shown; on error a short message and a
 * Retry. Small links (Restore, Terms, Privacy, Have a code?) sit below.
 *
 * /paywall redirects here. All purchase logic reuses the existing helpers in
 * lib/purchases.ts and lib/pricing.ts.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { Pressable, ScrollView, View } from 'react-native';
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
import { directionalIcon, iconSize, Row, Screen, Text, useTheme } from '@waves/ui';

import { fill, useStrings } from '@/i18n';
import { PlainHeader } from '@/components/standard/PlainHeader';
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

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; offering: PurchasesOffering | null };

export default function UpgradeScreen() {
  const theme = useTheme();
  const { t, language } = useStrings();
  const toast = useToast();
  const entitlement = useEntitlement();
  const { info } = useCustomerTier();

  const plansLive = useFlagEnabled('paywall') && purchasesAvailable();
  const { isPaid } = entitlement;

  const [load, setLoad] = useState<LoadState>(() =>
    plansLive ? { status: 'loading' } : { status: 'ready', offering: null },
  );
  const [attempt, setAttempt] = useState(0);
  const [period, setPeriod] = useState<PlanPeriod>('monthly');
  const [selected, setSelected] = useState<PaidTier>(defaultSelectedTier());
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

  // Pick the available periods; if monthly is not in the offering, default
  // to yearly (fixes the empty-screen bug).
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
    if (chosen.tier === entitlement.tier) return;
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
  }, [chosen, purchasing, offering, entitlement.tier, toast, t, queryClient]);

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

  // CTA label
  const periodLabel = resolvedPeriod === 'yearly' ? t.paywall.perYear : t.paywall.perMonth;
  const ctaLabel = isPaid
    ? t.planScreen.alreadyPro
    : purchasing
      ? t.paywall.subscribing
      : chosen
        ? fill(t.planScreen.ctaGetPro, { price: chosen.priceString, period: periodLabel })
        : fill(t.planScreen.ctaGetPro, { price: '—', period: periodLabel });

  const ctaDisabled = isPaid || purchasing || !chosen || !plansLive;

  return (
    <Screen edges={['top', 'bottom']}>
      <PlainHeader title={t.planScreen.title} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.lg,
          gap: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Period toggle ─────────────────────────────────────────── */}
        {plansLive && periods.length > 1 ? (
          <PeriodToggle
            period={resolvedPeriod}
            periods={periods}
            savings={savings}
            onChange={setPeriod}
          />
        ) : null}

        {/* ── Free card ─────────────────────────────────────────────── */}
        <PlanCard
          title={t.planScreen.freeCardTitle}
          subtitle={t.planScreen.freeCardSubtitle}
          current={!isPaid}
          features={[
            t.planScreen.freeFeatureExpenses,
            t.planScreen.freeFeatureBalances,
            fill(t.planScreen.freeFeatureScans, { scans: FREE_MONTHLY_SCANS }),
            fill(t.planScreen.freeFeatureVoice, { commands: VOICE_AGENT_FREE_MONTHLY }),
            t.planScreen.freeFeatureAds,
          ]}
          dimmedFeatures={new Set([t.planScreen.freeFeatureAds])}
          icon="wallet-outline"
        />

        {/* ── Pro card ──────────────────────────────────────────────── */}
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
          <PlanCard
            title={`Pro${chosen ? ` · ${chosen.priceString}${periodLabel}` : ''}`}
            subtitle={t.planScreen.proCardSubtitle}
            current={isPaid}
            highlighted
            features={[
              t.planScreen.proFeatureNoAds,
              fill(t.planScreen.proFeatureScans, { scans: PRO_MONTHLY_SCANS }),
              fill(t.planScreen.proFeatureVoice, { commands: VOICE_AGENT_PRO_MONTHLY }),
              t.assistant.planRowTitle,
              ...(PRO_DEVICE_LIMIT > 1
                ? [fill(t.planScreen.proFeatureDevices, { devices: PRO_DEVICE_LIMIT })]
                : []),
            ]}
            aiFeatures={new Set([t.assistant.planRowTitle])}
            aiPillLabel={t.assistant.planRowPill}
            icon="star-outline"
            onSelect={
              !isPaid && cards.length > 0 ? () => setSelected(PlanTier.Pro as PaidTier) : undefined
            }
          />
        )}

        {/* ── Renewal note ──────────────────────────────────────────── */}
        {plansLive && !isPaid ? (
          <Text variant="micro" tone="muted" align="center">
            {t.paywall.renewNote}
          </Text>
        ) : null}
      </ScrollView>

      {/* ── Bottom action area ────────────────────────────────────── */}
      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.sm,
          paddingBottom: theme.spacing.md,
          gap: theme.spacing.sm,
        }}
      >
        {isPaid ? (
          /* Already Pro: label + manage link */
          <View style={{ alignItems: 'center', gap: theme.spacing.xs }}>
            <Text style={{ fontWeight: '700', fontSize: 17 }}>{t.planScreen.alreadyPro}</Text>
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
          /* Buy button */
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
            <Text tone="onBrand" style={{ fontSize: 17, fontWeight: '700' }}>
              {ctaLabel}
            </Text>
            {!purchasing ? (
              <Ionicons
                name={directionalIcon('arrow-forward')}
                size={iconSize.md}
                color={theme.color.onBrand}
              />
            ) : null}
          </Pressable>
        ) : null}

        {/* ── Small links row ─────────────────────────────────────── */}
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
// Sub-components
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
        alignSelf: 'center',
        backgroundColor: theme.color.surface,
        borderRadius: theme.radius.pill,
        padding: 4,
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
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              minWidth: 110,
              paddingHorizontal: theme.spacing.md,
              paddingVertical: 8,
              borderRadius: theme.radius.pill,
              backgroundColor: active ? theme.color.brand : 'transparent',
            }}
          >
            <Text
              style={{ fontWeight: '700', color: active ? theme.color.onBrand : theme.color.text }}
            >
              {label}
            </Text>
            {savePill ? (
              <Text
                variant="caption"
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

function PlanCard({
  title,
  subtitle,
  features,
  dimmedFeatures,
  aiFeatures,
  aiPillLabel,
  icon,
  current,
  highlighted,
  onSelect,
}: {
  title: string;
  subtitle: string;
  features: string[];
  dimmedFeatures?: Set<string>;
  aiFeatures?: Set<string>;
  aiPillLabel?: string;
  icon: keyof typeof Ionicons.glyphMap;
  current: boolean;
  highlighted?: boolean;
  onSelect?: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <Pressable
      accessibilityRole={onSelect ? 'radio' : 'none'}
      accessibilityState={onSelect ? { selected: current } : undefined}
      onPress={onSelect}
      style={({ pressed }) => ({
        backgroundColor: theme.color.surface,
        borderRadius: theme.radius.lg,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.md,
        borderWidth: highlighted ? 1.5 : 1,
        borderColor: highlighted ? theme.color.brand : theme.color.border,
        gap: theme.spacing.sm,
        opacity: onSelect && pressed ? 0.95 : 1,
        shadowColor: '#2A1E6B',
        shadowOpacity: highlighted && theme.scheme !== 'dark' ? 0.08 : 0,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 4 },
        elevation: highlighted ? 3 : 0,
      })}
    >
      {/* Card header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            backgroundColor: highlighted ? theme.color.brand : theme.color.brandSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons
            name={icon}
            size={22}
            color={highlighted ? theme.color.onBrand : theme.color.brand}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: '800', fontSize: 17 }}>{title}</Text>
          <Text variant="caption" tone="muted">
            {subtitle}
          </Text>
        </View>
        {current ? (
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

      <View style={{ height: 1, backgroundColor: theme.color.border }} />

      {/* Feature list */}
      <View style={{ gap: 8 }}>
        {features.map((feature) => {
          const dimmed = dimmedFeatures?.has(feature);
          return (
            <View
              key={feature}
              style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}
            >
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  backgroundColor: dimmed ? theme.color.surfaceMuted : theme.color.brand,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons
                  name={dimmed ? 'remove' : 'checkmark'}
                  size={13}
                  color={dimmed ? theme.color.textMuted : theme.color.onBrand}
                />
              </View>
              <Text
                variant="caption"
                style={{ flex: 1, color: dimmed ? theme.color.textMuted : theme.color.text }}
              >
                {feature}
              </Text>
              {aiFeatures?.has(feature) && aiPillLabel ? (
                <View
                  style={{
                    backgroundColor: theme.color.brand,
                    borderRadius: theme.radius.pill,
                    paddingHorizontal: 6,
                    paddingVertical: 1,
                  }}
                >
                  <Text variant="micro" tone="onBrand" style={{ fontWeight: '700' }}>
                    {aiPillLabel}
                  </Text>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </Pressable>
  );
}
