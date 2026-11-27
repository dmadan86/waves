/** Rentals: what came in this month, and one card per property. */

import { useEffect, useRef, type ReactElement } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { leaseEndsIn } from '@waves/core';
import { Button, directionalIcon, iconSize, Row, Screen, Text, useTheme } from '@waves/ui';

import { PersonalGuard } from '@/components/PersonalGuard';
import { PlainHeader, StandardCard } from '@/components/standard';
import { StatusPill, useWealthMoney, type PillTone } from '@/components/wealth/parts';
import { todayIso, usePersonalLedger } from '@/data/personal';
import { useOwnPropertyCount, usePersonalWealth, useSpaceName } from '@/data/personalWealth';
import { fill, useStrings } from '@/i18n';
import { houseEntering, EASE_OUT, popEntering, PressableScale, Stagger } from '@/lib/anim';
import { useBottomClearance } from '@/lib/clearance';
import { useDefaultCurrency } from '@/lib/currency';
import { router } from '@/lib/navigation';
import { spaceParams } from '@/lib/rentalScope';
import { useReducedMotion } from '@/lib/reducedMotion';
import { useEntitlement } from '@/lib/useEntitlement';
import { PROPERTY_ICON } from '@/lib/wizardIcons';
import { atPropertyLimit, monthRent, monthTotals, propertyView } from '@/lib/wealthPlan';

export const STATUS_TONE: Record<string, PillTone> = {
  paid: 'positive',
  part: 'warning',
  due: 'negative',
  overdue: 'negative',
  vacant: 'neutral',
};

/** The collected-this-month bar: sweeps from empty on first mount, retargets quietly after. */
function FillBar({ percent }: { percent: number }) {
  const theme = useTheme();
  const reduce = useReducedMotion();
  const first = useRef(true);
  const p = useSharedValue(reduce ? percent : 0);
  useEffect(() => {
    if (reduce) {
      p.set(percent);
      return;
    }
    const move = withTiming(percent, { duration: first.current ? 600 : 400, easing: EASE_OUT });
    p.set(first.current ? withDelay(120, move) : move);
    first.current = false;
  }, [percent, reduce, p]);
  const style = useAnimatedStyle(() => ({ width: `${p.get()}%` }));
  return <Animated.View style={[{ backgroundColor: theme.color.brand }, style]} />;
}

const fadeUp = (delay: number) => FadeInDown.duration(260).easing(EASE_OUT).delay(delay);

function RentalsBody() {
  const theme = useTheme();
  const reduce = useReducedMotion();
  const clearance = useBottomClearance();
  const { t } = useStrings();
  const w = t.wealth;
  const fmt = useWealthMoney();
  const dc = useDefaultCurrency();
  const { space } = useLocalSearchParams<{ space?: string }>();
  const subtitle = useSpaceName(space);
  const ledger = usePersonalLedger(space);
  const { properties, tenancies } = usePersonalWealth(space);
  const ownCount = useOwnPropertyCount(space);
  const { isPro } = useEntitlement();
  const today = todayIso();

  const active = properties.filter((p) => p.status === 'active');
  const views = active.map((p) => ({
    p,
    v: propertyView(p, tenancies, ledger.recurrings, ledger.txns, today),
  }));
  const sum = monthRent(
    views.filter((x) => (x.p.currency || dc) === dc).map((x) => x.v),
    ledger.txns,
    today.slice(0, 7),
  );
  const limit = atPropertyLimit(ownCount, isPro);
  const add = (): void =>
    router.push(limit ? '/paywall' : { pathname: '/rentals/add', params: spaceParams(space) });
  const statusText: Record<string, string> = {
    paid: w.statusPaid,
    part: w.statusPart,
    due: w.statusDue,
    overdue: w.statusOverdue,
    vacant: w.statusVacant,
  };

  const totals = monthTotals(sum.received, sum.expected);
  const pill = (status: string): ReactElement => (
    <StatusPill label={statusText[status] ?? ''} tone={STATUS_TONE[status] ?? 'neutral'} />
  );
  const stat = (label: string, value: bigint, last = false): ReactElement => (
    <View
      style={{
        flex: 1,
        gap: 2,
        paddingStart: theme.spacing.sm,
        borderStartWidth: last || label === w.receivedLabel ? 0 : 1,
        borderStartColor: theme.color.border,
      }}
    >
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text variant="body" numberOfLines={1} adjustsFontSizeToFit style={{ fontWeight: '700' }}>
        {fmt(value, dc)}
      </Text>
    </View>
  );

  // Only in a couple/home space: what is said there is read by the two of them alone.
  const lock = space ? (
    <Row style={{ alignItems: 'center', justifyContent: 'center', gap: theme.spacing.xs }}>
      <Ionicons name="lock-closed-outline" size={iconSize.sm} color={theme.color.textMuted} />
      <Text variant="micro" tone="muted" style={{ flexShrink: 1, textAlign: 'center' }}>
        {w.e2eeNote}
      </Text>
    </Row>
  ) : null;

  if (active.length === 0) {
    return (
      <Screen edges={[]}>
        <PlainHeader title={w.rentals} subtitle={subtitle} />
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: theme.spacing.md,
            paddingHorizontal: theme.spacing.xl,
            paddingBottom: clearance + theme.spacing.xl,
          }}
        >
          <View style={{ width: 120, height: 110 }}>
            <Animated.View entering={reduce ? undefined : houseEntering}>
              <Ionicons name="home-outline" size={96} color={theme.color.brand} />
            </Animated.View>
            <Animated.View
              entering={reduce ? undefined : popEntering(160)}
              style={{
                position: 'absolute',
                end: 0,
                bottom: 0,
                width: 52,
                height: 52,
                borderRadius: 26,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.color.bg,
              }}
            >
              <Ionicons name="key-outline" size={40} color={theme.color.brand} />
            </Animated.View>
          </View>
          <Animated.View entering={reduce ? undefined : fadeUp(240)}>
            <Text variant="title" style={{ fontWeight: '800', textAlign: 'center' }}>
              {w.trackRentTitle}
            </Text>
          </Animated.View>
          <Animated.View entering={reduce ? undefined : fadeUp(300)}>
            <Text variant="body" tone="muted" style={{ textAlign: 'center' }}>
              {w.trackRentSub}
            </Text>
          </Animated.View>
          <Animated.View
            entering={reduce ? undefined : fadeUp(360)}
            style={{ alignSelf: 'center', width: '70%', marginTop: theme.spacing.md }}
          >
            <Button label={w.addProperty} fullWidth onPress={add} />
          </Animated.View>
          {lock}
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={[]}>
      <PlainHeader
        title={w.rentals}
        subtitle={subtitle}
        trailing={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={w.addRental}
            hitSlop={10}
            onPress={add}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
          >
            <Ionicons name="add" size={iconSize.lg} color={theme.color.brand} />
            <Text variant="body" style={{ color: theme.color.brand, fontWeight: '700' }}>
              {w.addShort}
            </Text>
          </Pressable>
        }
      />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance + theme.spacing.xl,
          gap: theme.spacing.md,
        }}
      >
        {lock}
        <Stagger index={0}>
          <StandardCard style={{ gap: theme.spacing.md }}>
            <Text variant="body" style={{ fontWeight: '700' }}>
              {w.thisMonth}
            </Text>
            <Row>
              {stat(w.receivedLabel, sum.received)}
              {stat(w.statusDue, totals.due)}
              {stat(w.expectedLabel, sum.expected, true)}
            </Row>
            <View
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={fill(w.percentReceived, { pct: totals.percent })}
              accessibilityValue={{ min: 0, max: 100, now: totals.percent }}
              style={{
                height: 8,
                borderRadius: 4,
                flexDirection: 'row',
                overflow: 'hidden',
                backgroundColor: theme.color.surfaceMuted,
              }}
            >
              <FillBar percent={totals.percent} />
            </View>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text variant="caption" tone="muted">
                {fill(w.percentReceived, { pct: totals.percent })}
              </Text>
              <Text variant="caption" tone="muted">
                {fill(w.receivedOfExpected, {
                  received: fmt(sum.received, dc),
                  expected: fmt(sum.expected, dc),
                })}
              </Text>
            </Row>
          </StandardCard>
        </Stagger>

        <Stagger index={1}>
          <Text variant="body" style={{ fontWeight: '700' }}>
            {fill(w.propertiesCount, { n: active.length })}
          </Text>
        </Stagger>
        {views.map(({ p, v }, i) => {
          const cur = p.currency || dc;
          const tn = v.tenancy;
          const lease = tn ? leaseEndsIn(tn.endDate, today, 60) : null;
          return (
            <Stagger key={p.id} index={i + 2}>
              <PressableScale
                pressedScale={0.98}
                accessibilityRole="button"
                accessibilityLabel={p.name}
                onPress={() =>
                  router.push({
                    pathname: '/rentals/[id]',
                    params: { id: p.id, ...spaceParams(space) },
                  })
                }
              >
                <StandardCard style={{ gap: theme.spacing.md }}>
                  <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: theme.radius.sm,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: theme.color.brandSoft,
                      }}
                    >
                      <Ionicons
                        name={PROPERTY_ICON[p.type]}
                        size={iconSize.lg}
                        color={theme.color.brand}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text variant="body" numberOfLines={1} style={{ fontWeight: '700' }}>
                        {p.name}
                      </Text>
                      <Text variant="caption" tone="muted" numberOfLines={1}>
                        {w.propertyTypes[p.type]} · {tn ? tn.tenantName : w.vacantNote}
                      </Text>
                    </View>
                    {pill(v.status)}
                    <Ionicons
                      name={directionalIcon('chevron-forward')}
                      size={iconSize.md}
                      color={theme.color.textMuted}
                    />
                  </Row>
                  {tn ? (
                    <Row
                      style={{
                        borderTopWidth: 1,
                        borderTopColor: theme.color.border,
                        paddingTop: theme.spacing.sm,
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text variant="caption" tone="muted">
                          {w.rentBalance}
                        </Text>
                        <Text variant="body" style={{ fontWeight: '700' }}>
                          {fmt(v.balance.balance, cur)}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text variant="caption" tone="muted">
                          {w.depositHeld}
                        </Text>
                        <Text variant="body" style={{ fontWeight: '700' }}>
                          {fmt(tn.depositHeld, cur)}
                        </Text>
                      </View>
                    </Row>
                  ) : null}
                  {lease !== null ? (
                    <StatusPill label={fill(w.leaseEndsIn, { n: lease })} tone="warning" />
                  ) : null}
                </StandardCard>
              </PressableScale>
            </Stagger>
          );
        })}
        {limit ? (
          <Text variant="caption" tone="muted">
            {w.freeRentalLimit}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

export default function RentalsScreen() {
  return (
    <PersonalGuard>
      <RentalsBody />
    </PersonalGuard>
  );
}
