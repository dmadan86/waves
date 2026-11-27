/**
 * The household home: what a couple's or a family's group opens on. It is the
 * Personal home (`(tabs)/me.tsx`) for the group's shared ledger: the same plain
 * header, hero card, quick-action grid, "This month" card with its month pill,
 * Upcoming and Recent cards and the privacy pill, fed by the group's own
 * expenses, income plans and bills. A balance card adds the one thing a shared
 * ledger has that a personal one cannot: who owes whom.
 * Bills, Income and Upcoming open in place; the full expense list, balances and
 * settle-up sit on the ledger screen (`?view=ledger`).
 */
import { useEffect, useMemo, useState } from 'react';
import { BackHandler, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';

import {
  billUpcoming,
  billsMonthlyTotal,
  householdSummary,
  incomeTotal,
  mergeHouseholdUpcoming,
  monthlySpend,
  compactMoney,
  formatParts,
  money,
  perDayLeft,
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
  IncomeTab,
  OverviewTab,
  PlanningTab,
  UpcomingTab,
  type HouseholdData,
} from '@/components/household/HouseholdTabs';
import { TabHeader, TabIconButton } from '@/components/home/TabHeader';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { MonthPill, QuickActions } from '@/components/personal/PersonalHomeParts';
import { useBlockedUsers } from '@/data/blocked';
import { useGroupIncome } from '@/data/groupIncome';
import { RentalsRow } from '@/components/household/RentalsRow';
import { groupRentalsSummary, hasGroupRentals } from '@/lib/rentalScope';
import { occurrenceIds, useGroupRecurring, useMarkBillPaid } from '@/data/groupRecurring';
import {
  memberLookup,
  useGroup,
  useGroupBudget,
  useGroupLedger,
  useGroupRealtime,
} from '@/data/hooks';
import { todayIso, useGroupRecords } from '@/data/personal';
import { groupLabel, isGhost } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { usePersonalAmountsHidden } from '@/lib/amountsHidden';
import { useViewerId } from '@/lib/auth';
import { compactAmount, needsCompactTile } from '@/lib/householdHome';
import { memberNameById } from '@/lib/memberName';
import {
  barMove,
  householdBalancesRoute,
  householdBarRoute,
  householdLocalBack,
  householdViewFor,
} from '@/lib/householdTab';
import { monthLabel, monthShort, monthShortYear, monthsBetween, shiftMonth } from '@/lib/monthNav';
import { router, runBarMove, useGoBack } from '@/lib/navigation';
import {
  householdGearEntries,
  householdHomeButtons,
  householdMoreEntries,
  householdScanAction,
  householdTiles,
  runHouseholdAction,
  type HouseholdAction,
  type HouseholdEntry,
} from '@/lib/householdEntries';
import { usePullRefresh } from '@/lib/pullRefresh';

type MenuAnchorBox = { x: number; y: number; width: number; height: number };

type HTab = 'overview' | 'planning' | 'bills' | 'upcoming' | 'income';

const UPCOMING_DAYS = 30;

const tabFor = (hh?: string): HTab => householdViewFor(hh);

export function HouseholdScreen({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const h = t.hhome;
  const viewerId = useViewerId();
  const pull = usePullRefresh();
  const clearance = useTabBarClearance();
  const goBack = useGoBack('/');
  const { blockedIds } = useBlockedUsers();
  const { hidden, toggle } = usePersonalAmountsHidden();
  useGroupRealtime(groupId);

  const { group, everyone, expenses } = useGroup(groupId);
  const { rules } = useGroupRecurring(groupId);
  const { plans } = useGroupIncome(groupId);
  const budget = useGroupBudget(groupId);
  const markBillPaid = useMarkBillPaid(groupId);
  const [paidKeys, setPaidKeys] = useState<ReadonlySet<string>>(new Set());
  // The bar's Planning tab arrives as `?hh=planning`; Home is the bare route.
  const { hh } = useLocalSearchParams<{ hh?: string }>();
  const [tab, setTab] = useState<HTab>(tabFor(hh));
  // A bar tap changes `hh`: follow it during render (no effect needed).
  const [seenHh, setSeenHh] = useState(hh);
  if (seenHh !== hh) {
    setSeenHh(hh);
    setTab(tabFor(hh));
  }
  // Hardware Back inside a local view returns to the view the route is on (Overview, or the
  // bar's Planning), consuming the press; on that view itself Back is the bar's or the stack's.
  const localBack = householdLocalBack(tab, hh) as HTab | null;
  useEffect(() => {
    if (localBack === null) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      setTab(localBack);
      return true;
    });
    return () => listener.remove();
  }, [localBack]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [monthsBack, setMonthsBack] = useState(0);
  const [monthMenuOpen, setMonthMenuOpen] = useState(false);
  const [monthAnchor, setMonthAnchor] = useState<MenuAnchorBox | null>(null);
  const ledger = useGroupLedger(groupId, viewerId);

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

  // The three headline tiles are tight on a phone: short figures from 1 lakh/100K up, the standard
  // formatter (so no stray ".0") below that.
  const tileFmt = (minor: bigint): string =>
    hidden || !needsCompactTile(minor)
      ? fmt(minor)
      : compactMoney(money(minor, currency as CurrencyCode), { locale });

  const live = useMemo(
    () => expenses.rows.filter((row) => row.currentVersion && !row.deleted_at),
    [expenses.rows],
  );
  const currentMonth = today.slice(0, 7);
  const month = monthsBack === 0 ? currentMonth : shiftMonth(currentMonth, -monthsBack);
  // Browse back to the first month with an expense, never into empty past.
  const earliest = useMemo(
    () =>
      live.reduce(
        (min, row) =>
          row.currentVersion!.expense_date.slice(0, 7) < min
            ? row.currentVersion!.expense_date.slice(0, 7)
            : min,
        currentMonth,
      ),
    [live, currentMonth],
  );
  const maxBack = Math.max(0, monthsBetween(earliest, currentMonth));
  const history = useMemo(
    () =>
      monthlySpend(
        live.map((row) => ({
          date: row.currentVersion!.expense_date,
          amount: BigInt(row.currentVersion!.amount),
          currency: row.currentVersion!.currency,
        })),
        currency,
        `${month}-01`,
      ),
    [live, currency, month],
  );
  const spent = history[history.length - 1]?.total ?? 0n;
  const last = history[history.length - 2]?.total ?? 0n;
  // Rent received this month in the household's own rentals counts as income.
  const rentalRecords = useGroupRecords(hasGroupRentals(group.data?.type) ? groupId : undefined);
  const rentals = useMemo(
    () => groupRentalsSummary(rentalRecords, month, currency),
    [rentalRecords, month, currency],
  );
  const income = incomeTotal(plans, currency) + rentals.received;
  const summary = householdSummary({ spent, lastMonthSpent: last, income });
  const budgetMinor = budget.data?.amountMinor ?? null;
  const limit =
    budgetMinor !== null && budgetMinor > 0n ? budgetMinor : income > 0n ? income : null;

  const upcoming = useMemo(
    () =>
      mergeHouseholdUpcoming([billUpcoming(rules, today, UPCOMING_DAYS)], 0).filter(
        (row) => row.currency === currency,
      ),
    [rules, today, currency],
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

  // Bar destinations move like the bar's own taps (this is the group root): same-screen views
  // swap params in place, Reports and Members push, so Home is never rebuilt and Back is Home.
  const barTo = (href: string): void => runBarMove(barMove(['group', '[id]'], href), href as never);
  const toLedger = (which?: 'balances'): void =>
    barTo(which ? householdBalancesRoute(groupId) : householdBarRoute(groupId, 'transactions'));

  // Destinations live in lib/householdEntries (pinned by tests); the screen adds labels and icons.
  const deps = {
    router: { push: router.push, replace: barTo },
    showView: (v: 'bills' | 'income' | 'upcoming') => setTab(v),
    openMore: () => setMoreOpen(true),
  };
  const go = (action: HouseholdAction) => () => runHouseholdAction(action, deps);
  const pick = (entries: HouseholdEntry[], key: string): HouseholdAction =>
    entries.find((entry) => entry.key === key)!.action;
  const tiles = householdTiles(groupId);
  const buttons = householdHomeButtons(groupId);
  const moreEntries = householdMoreEntries(groupId, 0);
  const gearEntries = householdGearEntries(groupId);
  /** An OverflowMenu row: a `route` action is the menu's own push, anything else a press. */
  const menuAction = (entries: HouseholdEntry[], key: string) => {
    const action = pick(entries, key);
    return action.kind === 'route' ? { route: action.route as never } : { onPress: go(action) };
  };

  if (!group.data) return <View style={{ flex: 1 }} />;

  const perDay = monthsBack === 0 && limit !== null ? perDayLeft(limit - spent, today) : 0n;
  const canBrowse = maxBack > 0;
  const monthItems: OverflowMenuItem[] = Array.from({ length: maxBack + 1 }, (_, back) => ({
    icon: back === monthsBack ? 'checkmark' : 'calendar-outline',
    label: monthLabel(shiftMonth(currentMonth, -back), locale),
    onPress: () => setMonthsBack(back),
  }));

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
    upcoming: openUpcoming,
    onMarkPaid,
    spent,
    income,
    limit,
    recent,
    perDay,
    billsMonthly: billsMonthlyTotal(rules, currency),
    monthPill: (
      <MonthPill
        label={monthLabel(month, locale)}
        spokenLabel={t.personal.dash.pickMonth}
        onPress={
          canBrowse
            ? (anchor) => {
                setMonthAnchor(anchor);
                setMonthMenuOpen(true);
              }
            : undefined
        }
      />
    ),
    onTab: setTab,
    onMore: () => setMoreOpen(true),
    onLedger: toLedger,
  };

  // Mirrors Personal: the More tile holds the less-used tools, the header menu the
  // space's own settings (people, scene, lock).
  const moreItems: OverflowMenuItem[] = [
    { icon: 'receipt-outline', label: h.allExpenses, ...menuAction(moreEntries, 'allExpenses') },
    {
      icon: 'swap-horizontal-outline',
      label: t.household.whoPaid,
      ...menuAction(moreEntries, 'whoPaid'),
    },
    { icon: 'notifications-outline', label: h.tabUpcoming, ...menuAction(moreEntries, 'upcoming') },
    { icon: 'pie-chart-outline', label: t.spending, ...menuAction(moreEntries, 'spending') },
    {
      icon: 'scan-outline',
      label: t.scanBill, // Stamped at the tap, so each scan opens the capture screen fresh.
      onPress: () => runHouseholdAction(householdScanAction(groupId), deps),
    },
    { icon: 'mic-outline', label: t.personalHome.moreVoice, ...menuAction(moreEntries, 'voice') },
    {
      icon: 'pricetags-outline',
      label: t.personal.dash.toolCategories,
      ...menuAction(moreEntries, 'categories'),
    },
    {
      icon: 'cloud-upload-outline',
      label: t.groupImport.menu,
      ...menuAction(moreEntries, 'import'),
    },
    { icon: 'download-outline', label: t.groupExport.menu, ...menuAction(moreEntries, 'export') },
  ];
  const menuItems: OverflowMenuItem[] = [
    {
      icon: 'people-outline',
      label: t.members,
      section: 'people',
      ...menuAction(gearEntries, 'members'),
    },
    {
      icon: 'qr-code-outline',
      label: t.people.inviteTitle,
      section: 'people',
      ...menuAction(gearEntries, 'invite'),
    },
    {
      icon: 'cash-outline',
      label: t.settleUp,
      section: 'people',
      ...menuAction(gearEntries, 'settle'),
    },
    {
      icon: 'settings-outline',
      label: t.group.settings,
      section: 'settings',
      ...menuAction(gearEntries, 'settings'),
    },
    {
      icon: 'image-outline',
      label: t.heroScene.title,
      section: 'settings',
      ...menuAction(gearEntries, 'scene'),
    },
    {
      icon: 'lock-closed-outline',
      label: t.personal.dash.settings,
      section: 'settings',
      ...menuAction(gearEntries, 'lock'),
    },
  ];

  const upcomingDot = upcoming.some((row) => row.inDays <= 0);
  const myBalance = ledger.myBalance;
  const balanceText =
    ledger.groupSettled || myBalance === 0n
      ? t.allSettled
      : myBalance > 0n
        ? t.youAreOwed
        : t.youOwe;
  const title = group.data?.name?.trim() || groupLabel(group.data, everyone.data ?? [], viewerId);
  const change = summary.changePct;

  return (
    <Screen edges={[]}>
      <TabHeader
        left={
          <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <TabIconButton
              icon={directionalIcon('arrow-back')}
              label={t.common.goBack}
              onPress={() =>
                tab === 'overview' ? goBack() : hh ? router.back() : setTab('overview')
              }
            />
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              style={{ flex: 1, minWidth: 0, fontSize: 18, lineHeight: 23, fontWeight: '700' }}
            >
              {title}
            </Text>
          </Row>
        }
      >
        <TabIconButton
          icon="search-outline"
          label={t.group.searchExpenses}
          onPress={go(pick(buttons, 'search'))}
        />
        <TabIconButton
          icon="notifications-outline"
          label={h.tabUpcoming}
          dot={upcomingDot}
          onPress={go(pick(buttons, 'bell'))}
        />
        <TabIconButton
          icon="ellipsis-vertical"
          label={t.group.settings}
          onPress={() => setMenuOpen(true)}
        />
      </TabHeader>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: clearance + 96 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={theme.color.brand}
          />
        }
      >
        <View
          style={{
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.xs,
            gap: theme.spacing.md,
          }}
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
                      <Text variant="body" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                        {monthsBack === 0
                          ? t.personal.dash.totalSpent
                          : fill(t.personal.dash.totalSpentIn, {
                              month: monthLabel(month, locale),
                            })}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={
                          hidden ? t.dashHero.showBalance : t.dashHero.hideBalance
                        }
                        onPress={toggle}
                        hitSlop={10}
                        style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
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
                    {change !== null && !hidden ? (
                      <Row
                        style={{ alignItems: 'center', gap: theme.spacing.sm, flexWrap: 'wrap' }}
                      >
                        <ChangePill change={change} />
                        <Text variant="caption" tone="muted" numberOfLines={1}>
                          {fill(t.personal.dash.vsMonth, {
                            month: monthShortYear(shiftMonth(month, -1), locale),
                          })}
                        </Text>
                      </Row>
                    ) : null}
                  </View>
                  {!hidden && history.length > 1 ? (
                    <SpendHistoryChart
                      values={history.map((m) => m.total)}
                      labels={history.map((m) => monthShort(m.month, locale))}
                    />
                  ) : null}
                </Row>
                <Row style={{ gap: theme.spacing.sm }}>
                  <FlowTile
                    icon="wallet-outline"
                    tone="income"
                    label={h.income}
                    value={tileFmt(income)}
                    hidden={hidden}
                    onPress={go(pick(buttons, 'flowIncome'))}
                  />
                  <FlowTile
                    icon="arrow-up"
                    tone="negative"
                    label={h.spent}
                    value={tileFmt(spent)}
                    hidden={hidden}
                    onPress={go(pick(buttons, 'flowSpent'))}
                  />
                  <FlowTile
                    icon="wallet"
                    tone="brand"
                    label={h.left}
                    value={`${summary.left < 0n ? '−' : ''}${tileFmt(summary.left < 0n ? -summary.left : summary.left)}`}
                    negative={summary.left < 0n}
                    hidden={hidden}
                    onPress={go(pick(buttons, 'flowLeft'))}
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
                    onPress: go(pick(tiles, 'expense')),
                  },
                  {
                    key: 'income',
                    tone: 'positive',
                    icon: 'arrow-down',
                    label: h.addIncome,
                    onPress: go(pick(tiles, 'income')),
                  },
                  {
                    key: 'bills',
                    tone: 'brand',
                    icon: 'repeat',
                    label: h.tabBills,
                    onPress: go(pick(tiles, 'bills')),
                  },
                  {
                    key: 'budget',
                    tone: 'brand',
                    icon: 'speedometer-outline',
                    label: t.household.budgetMenu,
                    onPress: go(pick(tiles, 'budget')),
                  },
                  {
                    key: 'settle',
                    tone: 'brand',
                    icon: 'cash-outline',
                    label: t.settleUp,
                    onPress: go(pick(tiles, 'settle')),
                  },
                  {
                    key: 'members',
                    tone: 'brand',
                    icon: 'people-outline',
                    label: t.members,
                    onPress: go(pick(tiles, 'members')),
                  },
                  {
                    key: 'expenses',
                    tone: 'brand',
                    icon: 'receipt-outline',
                    label: t.expenses,
                    onPress: go(pick(tiles, 'expenses')),
                  },
                  {
                    key: 'more',
                    tone: 'brand',
                    icon: 'ellipsis-horizontal',
                    label: t.personalHome.toolMore,
                    onPress: go(pick(tiles, 'more')),
                  },
                ]}
              />

              {/* Who owes whom: the one thing a shared ledger has that a personal one cannot. */}
              <Card style={{ padding: 0 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t.household.whoPaid}. ${balanceText}${myBalance === 0n ? '' : ` ${fmt(myBalance < 0n ? -myBalance : myBalance)}`}`}
                  onPress={go(pick(buttons, 'balance'))}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.md,
                    padding: theme.spacing.lg,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Ionicons
                    name="swap-horizontal-outline"
                    size={iconSize.md}
                    color={theme.color.brand}
                  />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      {t.household.whoPaid}
                    </Text>
                    <Text numberOfLines={1} style={{ fontWeight: '700' }}>
                      {balanceText}
                    </Text>
                  </View>
                  {myBalance !== 0n ? (
                    <Text
                      numberOfLines={1}
                      style={{
                        fontWeight: '700',
                        color: myBalance > 0n ? theme.color.positive : theme.color.negative,
                      }}
                    >
                      {fmt(myBalance < 0n ? -myBalance : myBalance)}
                    </Text>
                  ) : null}
                  <Ionicons
                    name={directionalIcon('chevron-forward')}
                    size={iconSize.sm}
                    color={theme.color.textMuted}
                  />
                </Pressable>
              </Card>

              {hasGroupRentals(group.data.type) ? (
                <RentalsRow
                  groupId={groupId}
                  count={rentals.count}
                  amountText={fmt(rentals.received)}
                />
              ) : null}

              <OverviewTab data={data} />
            </>
          ) : null}
          {tab === 'planning' ? <PlanningTab data={data} /> : null}
          {tab === 'bills' ? <BillsTab data={data} /> : null}
          {tab === 'upcoming' ? <UpcomingTab data={data} /> : null}
          {tab === 'income' ? <IncomeTab data={data} /> : null}
        </View>
      </ScrollView>
      <OverflowMenu visible={menuOpen} onClose={() => setMenuOpen(false)} items={menuItems} />
      <OverflowMenu visible={moreOpen} onClose={() => setMoreOpen(false)} items={moreItems} />
      <OverflowMenu
        visible={monthMenuOpen}
        onClose={() => setMonthMenuOpen(false)}
        items={monthItems}
        anchor={monthAnchor}
      />
    </Screen>
  );
}
