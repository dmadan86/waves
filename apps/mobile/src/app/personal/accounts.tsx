/**
 * Accounts: the money things you hold, one card each — Budgets, Loans,
 * Investments, Rentals — with a live one-line summary and a way in.
 */

import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';

import { investedSoFar, loanOutstanding, type CurrencyCode } from '@waves/core';
import { directionalIcon, iconSize, Row, Screen, Text, useTheme } from '@waves/ui';

import { PersonalGuard } from '@/components/PersonalGuard';
import { PlainHeader, StandardCard } from '@/components/standard';
import { useWealthMoney } from '@/components/wealth/parts';
import { todayIso, usePersonalLedger } from '@/data/personal';
import { usePersonalWealth } from '@/data/personalWealth';
import { usePersonalVehicles } from '@/data/vehicles';
import { fill, plural, useStrings, type PluralForms } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { useDefaultCurrency } from '@/lib/currency';
import { router } from '@/lib/navigation';
import {
  accountLine,
  otherCurrenciesLine,
  type AccountSummary,
  budgetsSummary,
  investedSummary,
  loansSummary,
  rentalsSummary,
  vehiclesSummary,
} from '@/lib/personalAccounts';
import { monthRent, monthTotals, propertyView } from '@/lib/wealthPlan';

function AccountCard({
  icon,
  title,
  line,
  note,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  line: string;
  note: string | null;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${line}${note ? `, ${note}` : ''}`}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <StandardCard>
        <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.brandSoft,
            }}
          >
            <Ionicons name={icon} size={iconSize.lg} color={theme.color.brand} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontWeight: '700' }}>{title}</Text>
            <Text variant="caption" tone="muted" numberOfLines={2}>
              {line}
            </Text>
            {note ? (
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {note}
              </Text>
            ) : null}
          </View>
          <Ionicons
            name={directionalIcon('chevron-forward')}
            size={iconSize.md}
            color={theme.color.textMuted}
          />
        </Row>
      </StandardCard>
    </Pressable>
  );
}

function AccountsBody() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const h = t.personalHome;
  const dc = useDefaultCurrency();
  const fmtMoney = useWealthMoney();
  const fmt = (amount: bigint): string => fmtMoney(amount, dc);
  const { budgets, loans, txns, recurrings } = usePersonalLedger();
  const { investments, properties, tenancies } = usePersonalWealth();
  const { vehicles } = usePersonalVehicles();
  const dayLabel = (iso: string): string =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
      new Date(`${iso}T00:00:00Z`),
    );
  const [today] = useState(todayIso);

  const lines = useMemo(() => {
    const month = today.slice(0, 7);
    const fmtIn = (amount: bigint, currency: string): string =>
      fmtMoney(amount, currency as CurrencyCode);
    const more = (n: number): string => fill(h.moreCurrencies, { n });
    const card = (
      summary: AccountSummary,
      strings: { live: PluralForms; none: string } | { live: string; none: string },
      key: string,
    ) => ({
      line: accountLine(summary, locale, strings, fmt, key),
      note: otherCurrenciesLine(summary.others, fmtIn, more),
    });
    // Shared loans settle in their own group; here their principal is the nearest figure.
    const loansS = loansSummary(
      loans.map((loan) => ({
        direction: loan.direction,
        status: loan.status,
        currency: loan.currency,
        left: loan.synced ? loan.principal : loanOutstanding(loan, txns),
      })),
      dc,
    );
    const investedS = investedSummary(
      investments
        .filter((i) => i.status === 'active')
        .map((i) => {
          const currency = i.currency || dc;
          return { currency, amount: investedSoFar({ ...i, currency }, txns) };
        }),
      dc,
    );
    const rentalsS = rentalsSummary(
      properties
        .filter((p) => p.status === 'active')
        .map((p) => {
          const view = propertyView(p, tenancies, recurrings, txns, today);
          const rent = monthRent([view], txns, month);
          return {
            currency: p.currency || dc,
            amount: monthTotals(rent.received, rent.expected).due,
          };
        }),
      dc,
    );
    const vs = vehiclesSummary(vehicles, today);
    const vehiclesLine =
      vs.count === 0
        ? h.vehiclesNone
        : fill(plural(locale, vs.count, vs.nextDue ? h.vehiclesNext : h.vehiclesLine), {
            n: vs.count,
            date: vs.nextDue ? dayLabel(vs.nextDue) : '',
          });
    return {
      vehicles: { line: vehiclesLine, note: null },
      budgets: card(
        budgetsSummary(budgets, txns, month, dc),
        { live: h.budgetsLine, none: h.budgetsNone },
        'left',
      ),
      loans: card(loansS, { live: h.loansLine, none: h.loansNone }, 'amount'),
      investments: card(investedS, { live: h.investedLine, none: h.investNone }, 'amount'),
      rentals: card(rentalsS, { live: h.rentalsLine, none: h.rentalsNone }, 'amount'),
    };
    // fmt closes over the stable money formatter and currency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    budgets,
    loans,
    txns,
    recurrings,
    investments,
    properties,
    tenancies,
    vehicles,
    today,
    dc,
    locale,
    h,
  ]);

  return (
    <Screen edges={[]}>
      <PlainHeader hideBack title={h.navAccounts} subtitle={h.accountsSub} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance + theme.spacing.xl,
          gap: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        <AccountCard
          icon="speedometer-outline"
          title={h.accBudgets}
          line={lines.budgets.line}
          note={lines.budgets.note}
          onPress={() => router.push('/personal/budgets')}
        />
        <AccountCard
          icon="people-outline"
          title={h.accLoans}
          line={lines.loans.line}
          note={lines.loans.note}
          onPress={() => router.push('/personal/loans')}
        />
        <AccountCard
          icon="trending-up-outline"
          title={h.accInvestments}
          line={lines.investments.line}
          note={lines.investments.note}
          onPress={() => router.push('/investments')}
        />
        <AccountCard
          icon="car-outline"
          title={t.vehicles.vehicles}
          line={lines.vehicles.line}
          note={null}
          onPress={() => router.push('/vehicles')}
        />
        <AccountCard
          icon="home-outline"
          title={h.accRentals}
          line={lines.rentals.line}
          note={lines.rentals.note}
          onPress={() => router.push('/rentals')}
        />
      </ScrollView>
    </Screen>
  );
}

export default function AccountsScreen() {
  return (
    <PersonalGuard>
      <AccountsBody />
    </PersonalGuard>
  );
}
