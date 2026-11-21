/**
 * The household home: what a couple's or a family's group opens on. It wears
 * the Personal home's clothes (`(tabs)/me.tsx`): the scenic header, the month
 * card, quick actions, budget, upcoming, recent spends, money tools and the
 * privacy pill, fed by the group's own expenses, income plans, bills and goals.
 * Bills, Income, Goals and Upcoming open in place from the money tools; the
 * full expense list, balances and settle-up sit on the ledger screen
 * (`?view=ledger`), one tap away in the ⋮ menu.
 */
import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
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
  type HouseholdUpcoming,
} from '@waves/core';
import {
  Card,
  directionalIcon,
  iconSize,
  Row,
  Screen,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

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
import { TabHeader, TabIconButton } from '@/components/home/TabHeader';
import { PersonAvatar } from '@/components/PersonAvatar';
import { useAddGoal } from '@/components/GroupGoalsCard';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { QuickActions } from '@/components/personal/PersonalHomeParts';
import { useBlockedUsers } from '@/data/blocked';
import { useGroupGoals } from '@/data/groupGoals';
import { useGroupIncome } from '@/data/groupIncome';
import { occurrenceIds, useGroupRecurring, useMarkBillPaid } from '@/data/groupRecurring';
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
  const clearance = useTabBarClearance() + theme.spacing.lg;
  const { t, locale } = useStrings();
  const h = t.hhome;
  const viewerId = useViewerId();
  const pull = usePullRefresh();
  const goBack = useGoBack('/');
  const { blockedIds } = useBlockedUsers();
  const { hidden, toggle } = usePersonalAmountsHidden();
  useGroupRealtime(groupId);

  const { group, everyone, expenses } = useGroup(groupId);
  const { rules } = useGroupRecurring(groupId);
  const { plans } = useGroupIncome(groupId);
  const { goals } = useGroupGoals(groupId);
  const budget = useGroupBudget(groupId);
  const markBillPaid = useMarkBillPaid(groupId);
  const [paidKeys, setPaidKeys] = useState<ReadonlySet<string>>(new Set());
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
  // A bill whose occurrence is already a live expense (this phone, another
  // phone or the server's generator) is paid: its row goes.
  const liveIds = useMemo(() => new Set(live.map((row) => row.id)), [live]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const paid = new Set<string>();
      for (const row of upcoming)
        if (row.kind === 'bill' && row.ruleId)
          if (liveIds.has((await occurrenceIds(row.ruleId, row.date)).expenseId)) paid.add(row.key);
      if (!cancelled) setPaidKeys(paid);
    })();
    return () => {
      cancelled = true;
    };
  }, [upcoming, liveIds]);
  const openUpcoming = useMemo(
    () => upcoming.filter((row) => !paidKeys.has(row.key)),
    [upcoming, paidKeys],
  );
  const onMarkPaid = async (row: HouseholdUpcoming): Promise<void> => {
    const rule = rules.find((r) => r.id === row.ruleId);
    if (!rule) return;
    await markBillPaid(rule, row.date);
    setPaidKeys((prev) => new Set(prev).add(row.key));
  };
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
    upcoming: openUpcoming,
    onMarkPaid,
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

  return (
    <Screen edges={[]}>
      <TabHeader
        left={
          <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
            <TabIconButton
              icon={directionalIcon('chevron-back')}
              label={t.common.goBack}
              onPress={() => (tab === 'overview' ? goBack() : setTab('overview'))}
            />
            <PersonAvatar name={group.data.name ?? ''} size={44} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                accessibilityRole="header"
                numberOfLines={1}
                style={{ fontSize: 18, lineHeight: 23, fontWeight: '700' }}
              >
                {group.data.name ?? ''}
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {t.personalHome.sharedSpace}
              </Text>
            </View>
          </Row>
        }
      >
        <TabIconButton
          icon="search-outline"
          label={t.group.searchExpenses}
          onPress={() => toLedger()}
        />
        <TabIconButton
          icon="notifications-outline"
          label={h.tabUpcoming}
          dot={upcoming.some((row) => row.inDays <= 0)}
          onPress={() => setTab('upcoming')}
        />
        <TabIconButton
          icon="ellipsis-vertical"
          label={t.group.settings}
          onPress={() => setMenuOpen(true)}
        />
      </TabHeader>
      <View style={{ flex: 1 }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.xs,
            paddingBottom: clearance,
            gap: theme.spacing.md,
          }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />
          }
        >
          {tab === 'overview' ? (
            <>
              <Card
                style={{
                  gap: theme.spacing.md,
                  padding: theme.spacing.lg,
                  backgroundColor: theme.color.brandSoft,
                }}
              >
                <Row style={{ alignItems: 'flex-start', gap: theme.spacing.md }}>
                  <View style={{ flex: 1, minWidth: 0, gap: theme.spacing.xs }}>
                    <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
                      <Text tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                        {h.thisMonth}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={
                          hidden ? t.dashHero.showBalance : t.dashHero.hideBalance
                        }
                        onPress={toggle}
                        hitSlop={10}
                      >
                        <Ionicons
                          name={hidden ? 'eye-off-outline' : 'eye-outline'}
                          size={iconSize.md}
                          color={theme.color.textMuted}
                        />
                      </Pressable>
                    </Row>
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.6}
                      style={{ fontSize: 30, lineHeight: 36, fontWeight: '700' }}
                    >
                      {fmt(spent)}
                    </Text>
                    {summary.changePct !== null && !hidden ? (
                      <Row
                        style={{ alignItems: 'center', gap: theme.spacing.sm, flexWrap: 'wrap' }}
                      >
                        <ChangePill change={summary.changePct} />
                        <Text variant="caption" tone="muted" numberOfLines={1}>
                          {h.vsLast}
                        </Text>
                      </Row>
                    ) : null}
                  </View>
                  {!hidden ? (
                    <SpendHistoryChart
                      values={history.map((m) => m.total)}
                      labels={history.map((m) => monthShort(m.month))}
                    />
                  ) : null}
                </Row>
                <Row style={{ gap: theme.spacing.sm }}>
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
              </Card>

              <QuickActions
                tiles={[
                  {
                    key: 'expense',
                    tone: 'brand',
                    icon: 'add',
                    label: h.addExpense,
                    onPress: () => router.push(`/group/${groupId}/add-expense`),
                  },
                  {
                    key: 'bill',
                    tone: 'brand',
                    icon: 'repeat',
                    label: h.addBill,
                    onPress: () => router.push(`/group/${groupId}/add-bills`),
                  },
                  {
                    key: 'income',
                    tone: 'positive',
                    icon: 'arrow-down',
                    label: h.addIncome,
                    onPress: () => router.push(`/group/${groupId}/income-edit`),
                  },
                  {
                    key: 'goal',
                    tone: 'brand',
                    icon: 'flag-outline',
                    label: h.addGoal,
                    onPress: addGoal,
                  },
                  {
                    key: 'aside',
                    tone: 'positive',
                    icon: 'save-outline',
                    label: h.putAside,
                    onPress: () =>
                      activeGoals.length === 1
                        ? router.push(`/group/${groupId}/goal/${activeGoals[0]!.goal.id}`)
                        : setTab('goals'),
                  },
                ]}
              />
            </>
          ) : null}

          {tab === 'overview' ? <OverviewTab data={data} /> : null}
          {tab === 'bills' ? <BillsTab data={data} /> : null}
          {tab === 'upcoming' ? <UpcomingTab data={data} /> : null}
          {tab === 'income' ? <IncomeTab data={data} /> : null}
          {tab === 'goals' ? <GoalsTab data={data} /> : null}
        </ScrollView>
      </View>
      <OverflowMenu visible={menuOpen} onClose={() => setMenuOpen(false)} items={menuItems} />
    </Screen>
  );
}
