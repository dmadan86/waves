/**
 * Accounts: the money things you hold, one card each — Budgets, Loans,
 * Investments, Rentals — with a live one-line summary and a way in.
 */

import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';

import { investedSoFar, loanOutstanding } from '@waves/core';
import { directionalIcon, iconSize, Row, Screen, Text, useTheme } from '@waves/ui';

import { PersonalGuard } from '@/components/PersonalGuard';
import { PlainHeader, StandardCard } from '@/components/standard';
import { useWealthMoney } from '@/components/wealth/parts';
import { todayIso, usePersonalLedger } from '@/data/personal';
import { usePersonalWealth } from '@/data/personalWealth';
import { useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { useDefaultCurrency } from '@/lib/currency';
import { router } from '@/lib/navigation';
import {
  accountLine,
  budgetsSummary,
  investedSummary,
  loansSummary,
  rentalsSummary,
} from '@/lib/personalAccounts';
import { monthRent, monthTotals, propertyView } from '@/lib/wealthPlan';

function AccountCard({
  icon,
  title,
  line,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  line: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${line}`}
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
  const [today] = useState(todayIso);

  const lines = useMemo(() => {
    const budgetsS = budgetsSummary(budgets, txns, today.slice(0, 7), dc);
    // Shared loans settle in their own group; here their principal is the nearest figure.
    const loansS = loansSummary(
      loans.map((loan) => ({
        direction: loan.direction,
        status: loan.status,
        left: loan.synced ? loan.principal : loanOutstanding(loan, txns),
      })),
    );
    const live = investments.filter((i) => i.status === 'active');
    const investedS = investedSummary(
      live.length,
      live
        .filter((i) => (i.currency || dc) === dc)
        .reduce((sum, i) => sum + investedSoFar({ ...i, currency: dc }, txns), 0n),
    );
    const views = properties
      .filter((p) => p.status === 'active')
      .map((p) => ({ p, v: propertyView(p, tenancies, recurrings, txns, today) }));
    const rent = monthRent(
      views.filter((x) => (x.p.currency || dc) === dc).map((x) => x.v),
      txns,
      today.slice(0, 7),
    );
    const rentalsS = rentalsSummary(views.length, monthTotals(rent.received, rent.expected).due);
    return {
      budgets: accountLine(
        budgetsS,
        locale,
        { live: h.budgetsLine, none: h.budgetsNone },
        fmt,
        'left',
      ),
      loans: accountLine(loansS, locale, { live: h.loansLine, none: h.loansNone }, fmt, 'amount'),
      investments: accountLine(
        investedS,
        locale,
        { live: h.investedLine, none: h.investNone },
        fmt,
        'amount',
      ),
      rentals: accountLine(
        rentalsS,
        locale,
        { live: h.rentalsLine, none: h.rentalsNone },
        fmt,
        'amount',
      ),
    };
    // fmt closes over the stable money formatter and currency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budgets, loans, txns, recurrings, investments, properties, tenancies, today, dc, locale, h]);

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
          line={lines.budgets}
          onPress={() => router.push('/personal/budgets')}
        />
        <AccountCard
          icon="people-outline"
          title={h.accLoans}
          line={lines.loans}
          onPress={() => router.push('/personal/loans')}
        />
        <AccountCard
          icon="trending-up-outline"
          title={h.accInvestments}
          line={lines.investments}
          onPress={() => router.push('/investments')}
        />
        <AccountCard
          icon="home-outline"
          title={h.accRentals}
          line={lines.rentals}
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
