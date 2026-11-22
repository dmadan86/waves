/**
 * The household home: what a couple's or a family's group opens on. It wears
 * the Personal home's clothes (`(tabs)/me.tsx`): the scenic header, the month
 * card, quick actions, budget, upcoming, recent spends, money tools and the
 * privacy pill, fed by the group's own expenses, income plans, bills and goals.
 * Bills, Income, Goals and Upcoming open in place from the money tools; the
 * full expense list, balances and settle-up sit on the ledger screen
 * (`?view=ledger`), one tap away in the ⋮ menu.
 */
import { useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import {
  billUpcoming,
  goalUpcoming,
  householdSummary,
  incomeTotal,
  mergeHouseholdUpcoming,
  monthlySpend,
  formatParts,
  money,
  type CurrencyCode,
} from '@waves/core';
import { directionalIcon, Row, Screen, Text, useTheme } from '@waves/ui';

import { BALANCE_MASK } from '@/components/home/HomeBalanceCard';
import { ChangePill, FlowTile, SpendHistoryChart } from '@/components/home/MonthParts';
import {
  BillsTab,
  GoalsTab,
  IncomeTab,
  OverviewTab,
  UpcomingTab,
  type HouseholdData,
} from '@/components/household/HouseholdTabs';
import { ScenicScreen } from '@/components/hero/ScenicScreen';
import { HeroIconButton } from '@/components/home/HeroControls';
import { HomeHeroBackground } from '@/components/home/HomeHeroBackground';
import { HomeBalanceCard } from '@/components/home/ScenicBalanceCard';
import { QuickActionsRow } from '@/components/home/QuickActionsRow';
import { useHomeHero } from '@/lib/useHomeHero';
import { useAddGoal } from '@/components/GroupGoalsCard';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { MoneyToolsRow } from '@/components/personal/PersonalHomeParts';
import { useBlockedUsers } from '@/data/blocked';
import { useGroupGoals } from '@/data/groupGoals';
import { useGroupIncome } from '@/data/groupIncome';
import { useGroupRecurring } from '@/data/groupRecurring';
import { memberLookup, useGroup, useGroupBudget, useGroupRealtime } from '@/data/hooks';
import { todayIso } from '@/data/personal';
import { isGhost } from '@/data/types';
import { useStrings } from '@/i18n';
import { usePersonalAmountsHidden } from '@/lib/amountsHidden';
import { useViewerId } from '@/lib/auth';
import { compactAmount } from '@/lib/householdHome';
import { memberNameById } from '@/lib/memberName';
import { router, useGoBack } from '@/lib/navigation';
import { usePullRefresh } from '@/lib/pullRefresh';

type HTab = 'overview' | 'bills' | 'upcoming' | 'income' | 'goals';

const UPCOMING_DAYS = 30;

export function HouseholdScreen({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const h = t.hhome;
  const viewerId = useViewerId();
  const pull = usePullRefresh();
  const homeHero = useHomeHero();
  const goBack = useGoBack('/');
  const { blockedIds } = useBlockedUsers();
  const { hidden, toggle } = usePersonalAmountsHidden();
  useGroupRealtime(groupId);

  const { group, everyone, expenses } = useGroup(groupId);
  const { rules } = useGroupRecurring(groupId);
  const { plans } = useGroupIncome(groupId);
  const { goals } = useGroupGoals(groupId);
  const budget = useGroupBudget(groupId);
  const [tab, setTab] = useState<HTab>('overview');
  const [menuOpen, setMenuOpen] = useState(false);

  const currency = group.data?.default_currency ?? 'INR';
  const today = todayIso();
  const lookup = useMemo(() => memberLookup(everyone.data), [everyone.data]);
  const nameOf = (memberId: string | null): string =>
    memberNameById(lookup, memberId, {
      viewerId,
      blocked: blockedIds,
      someone: t.misc.someone,
      leftLabel: t.misc.memberLeft,
    });
  const fmt = (minor: bigint): string =>
    hidden
      ? BALANCE_MASK
      : compactAmount(formatParts(money(minor, currency as CurrencyCode), { locale }));

  const live = useMemo(
    () => expenses.rows.filter((row) => row.currentVersion && !row.deleted_at),
    [expenses.rows],
  );
  const history = useMemo(
    () =>
      monthlySpend(
        live.map((row) => ({
          date: row.currentVersion!.expense_date,
          amount: BigInt(row.currentVersion!.amount),
          currency: row.currentVersion!.currency,
        })),
        currency,
        today,
      ),
    [live, currency, today],
  );
  const spent = history[history.length - 1]?.total ?? 0n;
  const last = history[history.length - 2]?.total ?? 0n;
  const income = incomeTotal(plans, currency);
  const summary = householdSummary({ spent, lastMonthSpent: last, income });
  const budgetMinor = budget.data?.amountMinor ?? null;
  const limit =
    budgetMinor !== null && budgetMinor > 0n ? budgetMinor : income > 0n ? income : null;

  const upcoming = useMemo(
    () =>
      mergeHouseholdUpcoming(
        [
          billUpcoming(rules, today, UPCOMING_DAYS),
          goalUpcoming(
            goals.map((view) => ({
              id: view.goal.id,
              name: view.goal.name,
              currency: view.goal.currency,
              status: view.goal.status,
              monthlyPlan: view.goal.monthlyPlan,
            })),
            today,
            UPCOMING_DAYS,
          ),
        ],
        0,
      ).filter((row) => row.currency === currency),
    [rules, goals, today, currency],
  );
  const recent = [...live]
    .sort((a, b) =>
      a.currentVersion!.expense_date === b.currentVersion!.expense_date
        ? b.created_at.localeCompare(a.created_at)
        : b.currentVersion!.expense_date.localeCompare(a.currentVersion!.expense_date),
    )
    .slice(0, 3);

  const activeGoals = goals.filter((view) => view.goal.status === 'active');
  const addGoal = useAddGoal(groupId, activeGoals.length);
  const toLedger = (which?: 'balances'): void =>
    router.push(`/group/${groupId}?view=ledger${which ? `&tab=${which}` : ''}`);

  if (!group.data) return <View style={{ flex: 1 }} />;

  const data: HouseholdData = {
    groupId,
    currency,
    hidden,
    fmt,
    nameOf,
    isGhostMember: (id) => {
      const member = lookup.get(id);
      return member ? isGhost(member) : false;
    },
    rules,
    plans,
    goals,
    upcoming,
    spent,
    income,
    limit,
    recent,
    onAddGoal: addGoal,
    onTab: setTab,
    onMore: () => setMenuOpen(true),
    onLedger: toLedger,
  };

  const menuItems: OverflowMenuItem[] = [
    { icon: 'receipt-outline', label: h.allExpenses, onPress: () => toLedger(), section: 'money' },
    {
      icon: 'swap-horizontal-outline',
      label: t.household.whoPaid,
      onPress: () => toLedger('balances'),
      section: 'money',
    },
    {
      icon: 'cash-outline',
      label: t.settleUp,
      route: `/group/${groupId}/settle`,
      section: 'money',
    },
    {
      icon: 'people-outline',
      label: t.members,
      route: `/group/${groupId}/members`,
      section: 'people',
    },
    {
      icon: 'qr-code-outline',
      label: t.people.inviteTitle,
      route: `/group/${groupId}/invite`,
      section: 'people',
    },
    {
      icon: 'wallet-outline',
      label: t.household.budgetMenu,
      route: `/group/${groupId}/budget`,
      section: 'money',
    },
    {
      icon: 'pie-chart-outline',
      label: t.spending,
      route: `/group/${groupId}/insights`,
      section: 'money',
    },
    {
      icon: 'settings-outline',
      label: t.group.settings,
      route: `/group/${groupId}/settings`,
      section: 'settings',
    },
  ];

  const monthShort = (month: string): string =>
    new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(
      new Date(`${month}-01T00:00:00Z`),
    );

  const tools = (
    <MoneyToolsRow
      tiles={[
        {
          key: 'bills',
          tint: 'lilac',
          icon: 'repeat',
          label: h.tabBills,
          onPress: () => setTab('bills'),
        },
        {
          key: 'income',
          tint: 'mint',
          icon: 'arrow-down',
          label: h.tabIncome,
          onPress: () => setTab('income'),
        },
        {
          key: 'goals',
          tint: 'sky',
          icon: 'flag-outline',
          label: h.tabGoals,
          onPress: () => setTab('goals'),
        },
        {
          key: 'expenses',
          tint: 'peach',
          icon: 'receipt-outline',
          label: t.expenses,
          onPress: () => toLedger(),
        },
      ]}
    />
  );
  const glyph = (name: keyof typeof Ionicons.glyphMap) => ({
    glyph: (color: string) => <Ionicons name={name} size={28} color={color} />,
  });
  const upcomingDot = upcoming.some((row) => row.inDays <= 0);

  return (
    <Screen edges={[]}>
      <ScenicScreen
        background={(g) => <HomeHeroBackground hero={homeHero} {...g} />}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={theme.color.brand}
          />
        }
        header={(ink, solid) => (
          <>
            <HeroIconButton
              icon={directionalIcon('chevron-back')}
              label={t.common.goBack}
              onPress={() => (tab === 'overview' ? goBack() : setTab('overview'))}
              ink={ink}
            />
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              style={{
                flex: 1,
                minWidth: 0,
                color: ink,
                fontSize: 20,
                lineHeight: 26,
                fontWeight: '700',
                ...(solid
                  ? null
                  : {
                      textShadowColor: 'rgba(0,0,0,0.35)',
                      textShadowOffset: { width: 0, height: 1 },
                      textShadowRadius: 4,
                    }),
              }}
            >
              {group.data?.name ?? ''}
            </Text>
            <HeroIconButton
              icon="search-outline"
              label={t.group.searchExpenses}
              onPress={() => toLedger()}
              ink={ink}
            />
            <HeroIconButton
              icon="notifications-outline"
              label={h.tabUpcoming}
              dot={upcomingDot}
              onPress={() => setTab('upcoming')}
              ink={ink}
            />
            <HeroIconButton
              icon="ellipsis-vertical"
              label={t.group.settings}
              onPress={() => setMenuOpen(true)}
              ink={ink}
            />
          </>
        )}
        card={(sceneRef) =>
          tab !== 'overview' ? null : (
            <HomeBalanceCard
              net={0n}
              owed={0n}
              owing={0n}
              owedGroups={0}
              owingGroups={0}
              currency={currency}
              locale={locale}
              hidden={hidden}
              onToggleHide={toggle}
              settling={false}
              loading={false}
              blurTarget={sceneRef}
              label={h.thisMonth}
              amountText={fmt(spent)}
              labelAccessory={
                summary.changePct !== null && !hidden ? (
                  <Row style={{ alignItems: 'center', gap: theme.spacing.xs, flexShrink: 1 }}>
                    <ChangePill change={summary.changePct} />
                    <Text
                      variant="caption"
                      tone="muted"
                      numberOfLines={1}
                      style={{ flexShrink: 1 }}
                    >
                      {h.vsLast}
                    </Text>
                  </Row>
                ) : null
              }
              extra={
                hidden || history.length < 2 ? null : (
                  <View style={{ alignItems: 'flex-end', paddingHorizontal: theme.spacing.lg }}>
                    <SpendHistoryChart
                      values={history.map((m) => m.total)}
                      labels={history.map((m) => monthShort(m.month))}
                    />
                  </View>
                )
              }
              sides={
                <Row
                  style={{
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    paddingHorizontal: theme.spacing.lg,
                  }}
                >
                  <FlowTile
                    icon="wallet-outline"
                    tone="income"
                    label={h.income}
                    value={fmt(income)}
                    hidden={hidden}
                    onPress={() => setTab('income')}
                  />
                  <FlowTile
                    icon="arrow-up"
                    tone="negative"
                    label={h.spent}
                    value={fmt(spent)}
                    hidden={hidden}
                    onPress={() => toLedger()}
                  />
                  <FlowTile
                    icon="wallet"
                    tone="brand"
                    label={h.left}
                    value={`${summary.left < 0n ? '−' : ''}${fmt(summary.left < 0n ? -summary.left : summary.left)}`}
                    negative={summary.left < 0n}
                    hidden={hidden}
                    onPress={() => setTab('overview')}
                  />
                </Row>
              }
              footer={
                <QuickActionsRow
                  radius={theme.radius.xl}
                  discColor="transparent"
                  iconColor={theme.color.brand}
                  discSize={32}
                  rowPadding={theme.spacing.sm}
                  actions={[
                    {
                      key: 'expense',
                      label: h.addExpense,
                      ...glyph('add-circle-outline'),
                      onPress: () => router.push(`/group/${groupId}/add-expense`),
                    },
                    {
                      key: 'bill',
                      label: h.addBill,
                      ...glyph('repeat'),
                      onPress: () => router.push(`/group/${groupId}/add-bills`),
                    },
                    {
                      key: 'income',
                      label: h.addIncome,
                      ...glyph('arrow-down-circle-outline'),
                      onPress: () => router.push(`/group/${groupId}/income-edit`),
                    },
                    {
                      key: 'more',
                      label: t.personalHome.toolMore,
                      ...glyph('ellipsis-horizontal-circle-outline'),
                      onPress: () => setMenuOpen(true),
                    },
                  ]}
                />
              }
            />
          )
        }
      >
        {/* Bills, Income, Goals and Expenses, a compact row just under the card. */}
        {tab === 'overview' ? <View style={{ paddingTop: theme.spacing.xs }}>{tools}</View> : null}
        <View style={{ gap: theme.spacing.md, paddingTop: theme.spacing.xs }}>
          {tab === 'overview' ? <OverviewTab data={data} /> : null}
          {tab === 'bills' ? <BillsTab data={data} /> : null}
          {tab === 'upcoming' ? <UpcomingTab data={data} /> : null}
          {tab === 'income' ? <IncomeTab data={data} /> : null}
          {tab === 'goals' ? <GoalsTab data={data} /> : null}
        </View>
      </ScenicScreen>
      <OverflowMenu visible={menuOpen} onClose={() => setMenuOpen(false)} items={menuItems} />
    </Screen>
  );
}
