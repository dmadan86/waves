/** Investments: what goes in each month, what has gone in so far, and one row per holding. */

import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, View } from 'react-native';

import {
  goingInPerMonth,
  investedSoFar,
  INVESTMENT_TYPES,
  stepOccurrence,
  type InvestmentType,
  type PersonalInvestment,
} from '@waves/core';
import { Button, IconButton, iconSize, Row, Screen, Text, useTheme } from '@waves/ui';

import { PersonalGuard } from '@/components/PersonalGuard';
import { ListRow, PlainHeader, SectionHeader, StandardCard } from '@/components/standard';
import { StatusPill, useWealthMoney } from '@/components/wealth/parts';
import { todayIso, usePersonalLedger } from '@/data/personal';
import { usePersonalWealth } from '@/data/personalWealth';
import { fill, useStrings } from '@/i18n';
import { Stagger } from '@/lib/anim';
import { useDefaultCurrency } from '@/lib/currency';
import { useBottomClearance } from '@/lib/clearance';
import { useEntitlement } from '@/lib/useEntitlement';
import { router } from '@/lib/navigation';
import { atInvestmentLimit } from '@/lib/wealthPlan';

function InvestmentsBody() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const w = t.wealth;
  const fmt = useWealthMoney();
  const dc = useDefaultCurrency();
  const ledger = usePersonalLedger();
  const { investments } = usePersonalWealth();
  const { isPro } = useEntitlement();
  const today = todayIso();

  const active = investments.filter((i) => i.status === 'active');
  const cur = (i: PersonalInvestment): string => i.currency || dc;
  const shown = investments.filter((i) => cur(i) === dc);
  const totalIn = shown
    .filter((i) => i.status === 'active')
    .reduce((s, i) => s + investedSoFar({ ...i, currency: dc }, ledger.txns), 0n);
  const perMonth = goingInPerMonth(
    ledger.recurrings.filter((r) => active.some((i) => i.id === r.investmentId)),
    dc,
  );
  const limit = atInvestmentLimit(active.length, isPro);

  const nextLabel = (inv: PersonalInvestment): string => {
    const rule = ledger.recurrings.find((r) => r.investmentId === inv.id && r.active);
    if (!rule) return w.noSchedule;
    let d = rule.nextDate;
    for (let i = 0; d < today && i < 800; i += 1) d = stepOccurrence(rule, d);
    return fill(w.nextOn, {
      date: new Date(`${d}T12:00:00`).toLocaleDateString(locale, {
        day: 'numeric',
        month: 'short',
      }),
    });
  };

  const groups = INVESTMENT_TYPES.map((type) => ({
    type,
    rows: investments.filter((i) => i.type === type),
  })).filter((g) => g.rows.length > 0);

  const add = (): void => router.push(limit ? '/paywall' : '/investments/add');

  if (investments.length === 0) {
    return (
      <Screen edges={[]}>
        <PlainHeader title={w.investments} />
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
            <Ionicons name="trending-up-outline" size={96} color={theme.color.brand} />
            <View
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
              <Ionicons name="wallet-outline" size={40} color={theme.color.brand} />
            </View>
          </View>
          <Text variant="title" style={{ fontWeight: '800', textAlign: 'center' }}>
            {w.trackInvTitle}
          </Text>
          <Text variant="body" tone="muted" style={{ textAlign: 'center' }}>
            {w.emptyInvestments}
          </Text>
          <View style={{ alignSelf: 'center', width: '70%', marginTop: theme.spacing.md }}>
            <Button label={w.addInvestment} fullWidth onPress={add} />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={[]}>
      <PlainHeader
        title={w.investments}
        trailing={
          <IconButton label={w.addInvestment} onPress={add}>
            <Ionicons name="add" size={iconSize.xl} color={theme.color.brand} />
          </IconButton>
        }
      />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance + theme.spacing.xl,
          gap: theme.spacing.lg,
        }}
      >
        <StandardCard style={{ gap: theme.spacing.md }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="body">{w.goingIn}</Text>
            <Text variant="body" style={{ fontWeight: '700' }}>
              {fmt(perMonth, dc)}
            </Text>
          </Row>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="body">{w.investedSoFar}</Text>
            <Text variant="body" style={{ fontWeight: '700' }}>
              {fmt(totalIn, dc)}
            </Text>
          </Row>
        </StandardCard>

        {groups.map((g, gi) => (
          <Stagger key={g.type} index={gi}>
            <View style={{ gap: theme.spacing.sm }}>
              <SectionHeader title={w.types[g.type as InvestmentType]} />
              <StandardCard>
                {g.rows.map((inv, i) => (
                  <ListRow
                    key={inv.id}
                    title={inv.name}
                    subtitle={inv.status === 'closed' ? w.closed : nextLabel(inv)}
                    amount={fmt(
                      investedSoFar({ ...inv, currency: cur(inv) }, ledger.txns),
                      cur(inv),
                    )}
                    trailing={
                      inv.status === 'closed' ? (
                        <StatusPill label={w.closed} tone="neutral" />
                      ) : undefined
                    }
                    onPress={() =>
                      router.push({ pathname: '/investments/[id]', params: { id: inv.id } })
                    }
                    divider={i < g.rows.length - 1}
                  />
                ))}
              </StandardCard>
            </View>
          </Stagger>
        ))}
        {limit ? (
          <Text variant="caption" tone="muted">
            {w.freeInvestmentLimit}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

export default function InvestmentsScreen() {
  return (
    <PersonalGuard>
      <InvestmentsBody />
    </PersonalGuard>
  );
}
