/**
 * The full personal ledger (A48): every entry, newest first, grouped by day.
 * Tapping one opens it to edit; the header "+" adds a new one.
 *
 * A `category` param narrows it to one category — where the budget sheet's
 * "View transactions" lands, so a cap that looks wrong can be checked against
 * the entries behind it. The filter is the ledger's own: every entry filed
 * under that category, income and loan repayments included. A budget's own
 * arithmetic excludes some of those (see `personalBudgetProgress`), so this is
 * deliberately the longer list — "show me what I spent this on" is a question
 * about the ledger, and a list that quietly hid rows would be the harder thing
 * to explain.
 *
 * `kind` (income or expense) and `month` (YYYY-MM) narrow it the way the
 * Personal tab's tiles ask: its Income tile lands on the month's income, its
 * Spent tile on the month's spends, and a top category on that category's
 * entries for the month. Each narrowing is named under the title.
 *
 * On top of those, the screen's own search, kind tabs and category filter narrow
 * further in place. "Transfers" are the loan repayments: money moving between
 * the person and a loan. They also stay under Expenses or Income, which is
 * how the Personal tab's tiles count them.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  format,
  isInvestmentCategory,
  money,
  monthlyIncomeEntries,
  resolveCategory,
  type PersonalTxn,
} from '@waves/core';
import { localMonth } from '@/lib/expenseForm';
import {
  Button,
  directionalIcon,
  IconButton,
  iconSize,
  Row,
  Screen,
  Sheet,
  Text,
  useTheme,
} from '@waves/ui';

import { EmptyStateCta } from '@/components/EmptyStateCta';
import { personalTxnCategoryLabel } from '@/lib/personalTxnCategoryLabel';
import { filterTxns, groupByDay, type TxnTab } from '@/lib/txnLedger';
import { CategoryBadge, CategoryPicker } from '@/components/Category';
import { usePersonalLedger } from '@/data/personal';
import { monthlySpendEntries } from '@/lib/monthlySpend';
import { deviceCountry, plural, useStrings } from '@/i18n';
import { paymentMethodLabel } from '@/lib/paymentMethodLabel';
import { PersonalGuard } from '@/components/PersonalGuard';
import { SlidingHighlight } from '@/lib/SlidingHighlight';
import { useBottomClearance } from '@/lib/clearance';
import { dateTimeFormat } from '@/lib/dateTimeFormat';
import { loanScope } from '@/lib/personalLoanScope';
import { router } from '@/lib/navigation';
import { SPEC_ACCENT, SPEC_INK, SPEC_MUTED } from '@/lib/specPalette';
import { monthLabel, shiftMonth } from '@/lib/monthNav';
import { SearchField } from '@/components/SearchToggle';
import {
  closeHeaderSearch,
  HEADER_SEARCH_CLOSED,
  openHeaderSearch,
  setHeaderQuery,
} from '@/lib/headerSearch';

type Tab = TxnTab;

/** One row of the flattened ledger: a day heading, or an entry under it. The
 *  entry knows whether it opens or closes its day, so the rows of one day draw
 *  as one card. */
type LedgerItem =
  | { kind: 'day'; key: string; day: string; count: number; net: bigint; currency: string }
  | { kind: 'txn'; key: string; txn: PersonalTxn; first: boolean; last: boolean };

const INCOME_INK = '#16935B';
const EXPENSE_INK = '#C8283E';

function PersonalTransactionsScreenBody() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const { txns } = usePersonalLedger();
  const dark = theme.scheme === 'dark';
  const ink = dark ? theme.color.text : SPEC_INK;
  const muted = dark ? theme.color.textMuted : SPEC_MUTED;
  const accent = dark ? theme.color.brand : SPEC_ACCENT;
  const lavender = dark ? theme.color.surfaceMuted : '#EFEDFA';
  const params = useLocalSearchParams<{
    category?: string;
    categoryMode?: string;
    kind?: string;
    month?: string;
    method?: string;
    currency?: string;
    uncategorized?: string;
    loan?: string;
    loans?: string;
    from?: string;
    to?: string;
    returnTo?: string;
  }>();
  const paramCategory = typeof params.category === 'string' ? params.category : null;
  // The dashboard's columns are buckets: a custom or unknown category is counted
  // under Other there, so it has to be listed under Other here too. Budgets pass
  // an exact id, custom ones included, and keep matching it exactly.
  const bucketed = params.categoryMode === 'bucket';
  const kindParam = params.kind === 'income' || params.kind === 'expense' ? params.kind : null;
  const month =
    typeof params.month === 'string' && /^\d{4}-\d{2}$/.test(params.month) ? params.month : null;

  // An inclusive date range, as the assistant's "Show in Spending" link sends it.
  const dateParam = (value: unknown): string | null =>
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  const fromDate = dateParam(params.from);
  const toDate = dateParam(params.to);

  // Extra narrowings from the dashboard, each dismissed by its own chip.
  const [dropLoan, setDropLoan] = useState(false);
  const loanId = typeof params.loan === 'string' && !dropLoan ? params.loan : null;
  const [dropCredit, setDropCredit] = useState(false);
  const [dropUncategorized, setDropUncategorized] = useState(false);
  const currencyParam =
    typeof params.currency === 'string' && /^[A-Z]{3}$/.test(params.currency)
      ? params.currency
      : null;
  const creditOnly = params.method === 'credit' && !dropCredit;
  const uncategorizedOnly = params.uncategorized === '1' && !dropUncategorized;

  const [tab, setTab] = useState<Tab>(kindParam ?? 'all');
  const [tabsWidth, setTabsWidth] = useState(0);
  const [browseMonth, setBrowseMonth] = useState(month ?? localMonth());
  const [monthEnabled, setMonthEnabled] = useState(true);
  const [search, setSearch] = useState(HEADER_SEARCH_CLOSED);
  const query = search.query;
  const setQuery = (value: string) => setSearch((s) => setHeaderQuery(s, value));
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(timer);
  }, [query]);
  const drillIn = [
    params.category,
    params.kind,
    params.month,
    params.method,
    params.uncategorized,
    params.loan,
    params.from,
    params.to,
  ].some((value) => value !== undefined);
  const addExpense = () =>
    router.push({ pathname: '/personal/entry', params: { kind: 'expense' } });
  const clearFilters = (): void => {
    setPicked(null);
    setQuery('');
    setTab('all');
    setBrowseMonth(localMonth());
    setMonthEnabled(false);
    if (drillIn) router.replace('/personal/transactions');
  };
  // The filter sheet's pick replaces the one the screen was opened with.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);
  const filter = picked === undefined ? paramCategory : picked;

  const filterButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t.personal.filterCategory}
      accessibilityState={{ selected: filter !== null }}
      onPress={() => setFilterOpen(true)}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: filter ? accent : theme.color.surface,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Ionicons name="filter" size={20} color={filter ? '#FFFFFF' : ink} />
    </Pressable>
  );

  const labelFor = (id: string | null): string | null =>
    personalTxnCategoryLabel(id, (key) => t.categories[key as keyof typeof t.categories] ?? null);

  /**
   * Grouped by day, flattened into one recyclable list — a heading item where
   * the day changes, then its entries. The ledger already comes newest first,
   * so days do too. FlashList recycles each kind against its own pool, the way
   * the group month screen does.
   */
  const items: LedgerItem[] = useMemo(() => {
    // The same entries the dashboard's income total counts (one shared selector).
    const selectedMonth = monthEnabled ? browseMonth : null;
    const incomeIds =
      tab === 'income' && selectedMonth && currencyParam
        ? new Set(monthlyIncomeEntries(txns, selectedMonth, currencyParam).map((entry) => entry.id))
        : null;
    const spendIds =
      tab === 'expense' && selectedMonth && currencyParam
        ? new Set(monthlySpendEntries(txns, selectedMonth, currencyParam).map((entry) => entry.id))
        : null;
    const matchesCategory = (category: string | null | undefined): boolean =>
      (!uncategorizedOnly || !category) &&
      (!filter ||
        (bucketed && picked === undefined
          ? (resolveCategory(category ?? null, null).builtinId ?? 'other') === filter
          : category === filter));
    const shown = filterTxns(loanScope(txns, { loanId, excludeLoans: params.loans === 'none' }), {
      tab,
      needle: debouncedQuery,
      locale,
      categoryMatch: matchesCategory,
      creditOnly,
      currency: currencyParam,
      categoryLabel: (id) => t.categories[id as keyof typeof t.categories] ?? id,
      month: monthEnabled ? browseMonth : null,
      from: fromDate,
      to: toDate,
    }).filter((txn) =>
      incomeIds
        ? incomeIds.has(txn.id)
        : spendIds
          ? spendIds.has(txn.id)
          : !(kindParam === 'income' && isInvestmentCategory(txn.category)),
    );
    const list: LedgerItem[] = [];
    for (const { rows, ...day } of groupByDay(shown)) {
      list.push({ kind: 'day', key: `day-${day.day}`, ...day });
      if (!collapsedDays.has(day.day)) {
        rows.forEach((txn, at) =>
          list.push({
            kind: 'txn',
            key: txn.id,
            txn,
            first: at === 0,
            last: at === rows.length - 1,
          }),
        );
      }
    }
    return list;
  }, [
    currencyParam,
    kindParam,
    txns,
    filter,
    picked,
    bucketed,
    creditOnly,
    uncategorizedOnly,
    loanId,
    params.loans,
    browseMonth,
    monthEnabled,
    fromDate,
    toDate,
    tab,
    debouncedQuery,
    locale,
    t,
    collapsedDays,
  ]);

  const signed = (amount: bigint, currency: string, income: boolean): string =>
    `${income ? '+' : '-'}${format(money(amount < 0n ? -amount : amount, currency), { locale, trimZeros: true })}`;

  const tabs: {
    value: Tab;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    color: string;
    rotation?: `${number}deg`;
  }[] = [
    { value: 'all', label: t.personal.all, icon: 'list', color: accent },
    {
      value: 'expense',
      label: t.personal.expenses,
      icon: 'arrow-down',
      color: EXPENSE_INK,
      rotation: '-45deg',
    },
    {
      value: 'income',
      label: t.personal.income,
      icon: 'arrow-up',
      color: INCOME_INK,
      rotation: '45deg',
    },
    { value: 'transfer', label: t.personal.transfers, icon: 'swap-horizontal', color: '#2875CE' },
  ];

  return (
    <Screen>
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.sm, gap: 10 }}>
        {search.open ? (
          <SearchField
            value={query}
            onChange={setQuery}
            onCancel={() => {
              setQuery('');
              setSearch(closeHeaderSearch());
            }}
            placeholder={t.personal.searchTransactions}
            trailing={filterButton}
          />
        ) : (
          <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
            {drillIn ? (
              <IconButton
                label={t.common.back}
                onPress={() =>
                  params.returnTo && !router.canGoBack()
                    ? router.replace(params.returnTo as never)
                    : router.back()
                }
              >
                <Ionicons name={directionalIcon('chevron-back')} size={iconSize.lg} color={ink} />
              </IconButton>
            ) : null}
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text
                style={{ fontSize: 28, lineHeight: 34, fontWeight: '800', color: ink }}
                numberOfLines={1}
              >
                {t.personal.transactions}
              </Text>
              <Text style={{ fontSize: 13, lineHeight: 18, color: muted }} numberOfLines={2}>
                {t.personal.transactionsSubtitle}
              </Text>
              {filter ? (
                <Text style={{ fontSize: 12, color: muted }}>{labelFor(filter) ?? filter}</Text>
              ) : null}
              {fromDate && toDate ? (
                <Text style={{ fontSize: 12, color: muted }} numberOfLines={1}>
                  {fromDate === toDate ? fromDate : `${fromDate} – ${toDate}`}
                </Text>
              ) : null}
            </View>
            <IconButton
              label={t.personal.searchTransactions}
              onPress={() => setSearch(openHeaderSearch)}
            >
              <Ionicons name="search" size={iconSize.xl} color={accent} />
            </IconButton>
            {/* The assistant, already pointed at the private ledger: what is said or
                typed there stays personal. */}
            <IconButton
              label={t.personal.askByVoice}
              onPress={() =>
                router.push({
                  pathname: '/voice',
                  params: { scope: 'personal', source: 'personal' },
                })
              }
            >
              <Ionicons name="mic-outline" size={iconSize.xl} color={accent} />
            </IconButton>
            <IconButton label={t.personal.addTransaction} onPress={addExpense}>
              <Ionicons name="add" size={iconSize.xl} color={accent} />
            </IconButton>
          </Row>
        )}

        <Row style={{ alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <IconButton
            label={t.personal.prevMonth}
            onPress={() => {
              setMonthEnabled(true);
              setBrowseMonth(shiftMonth(browseMonth, -1));
            }}
          >
            <Ionicons name={directionalIcon('chevron-back')} size={18} color={muted} />
          </IconButton>
          <Text style={{ fontSize: 14, fontWeight: '600', color: ink }}>
            {monthEnabled ? monthLabel(browseMonth, locale) : 'All months'}
          </Text>
          <IconButton
            label={t.personal.nextMonth}
            onPress={() => {
              setMonthEnabled(true);
              setBrowseMonth(shiftMonth(browseMonth, 1));
            }}
          >
            <Ionicons name={directionalIcon('chevron-forward')} size={18} color={muted} />
          </IconButton>
        </Row>

        <Row
          accessibilityRole="tablist"
          style={{ gap: 5 }}
          onLayout={(e) => setTabsWidth(e.nativeEvent.layout.width)}
        >
          {/* Resting segment backgrounds sit under the sliding highlight. */}
          <Row
            pointerEvents="none"
            style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, gap: 5 }}
          >
            {tabs.map((item) => (
              <View
                key={item.value}
                style={{
                  flex: 1,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: theme.color.surface,
                }}
              />
            ))}
          </Row>
          <SlidingHighlight
            index={Math.max(
              0,
              tabs.findIndex((x) => x.value === tab),
            )}
            count={tabs.length}
            width={tabsWidth}
            color={accent}
            radius={18}
            gap={5}
            height={36}
          />
          {tabs.map((item) => {
            const on = item.value === tab;
            return (
              <Pressable
                key={item.value}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                onPress={() => setTab(item.value)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  flexDirection: 'row',
                  gap: 3,
                  height: 36,
                  borderRadius: 18,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: on ? '#FFFFFF26' : `${item.color}18`,
                  }}
                >
                  <Ionicons
                    name={item.icon}
                    size={14}
                    color={on ? '#FFFFFF' : item.color}
                    style={item.rotation ? { transform: [{ rotate: item.rotation }] } : undefined}
                  />
                </View>
                <Text
                  style={{
                    flexShrink: 1,
                    fontSize: 11,
                    fontWeight: on ? '700' : '500',
                    color: on ? '#FFFFFF' : muted,
                  }}
                  numberOfLines={1}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </Row>

        {creditOnly || uncategorizedOnly || loanId ? (
          <Row style={{ gap: 6, flexWrap: 'wrap' }}>
            {loanId ? (
              <FilterChip
                label={t.personal.loanPayments}
                clearLabel={t.entry.clear}
                onClear={() => setDropLoan(true)}
              />
            ) : null}
            {creditOnly ? (
              <FilterChip
                label={t.personalHome.creditCard}
                clearLabel={t.entry.clear}
                onClear={() => setDropCredit(true)}
              />
            ) : null}
            {uncategorizedOnly ? (
              <FilterChip
                label={t.personalHome.uncategorized}
                clearLabel={t.entry.clear}
                onClear={() => setDropUncategorized(true)}
              />
            ) : null}
          </Row>
        ) : null}
      </View>

      <FlashList
        data={items}
        extraData={`${locale}|${theme.scheme}`}
        keyExtractor={(item) => item.key}
        getItemType={(item) => item.kind}
        // The group ledger's settings: render well beyond the viewport so a hard
        // fling down a long ledger never outruns recycling and flashes blank rows.
        drawDistance={1500}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance + theme.spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={{ paddingTop: theme.spacing.xxxl }}>
            <EmptyStateCta
              title={
                filter || query || tab !== 'all' || drillIn
                  ? 'No entries match these filters'
                  : `No entries in ${monthLabel(browseMonth, locale)}`
              }
              body={t.personal.transactionsSubtitle}
              action={
                filter || query || tab !== 'all' || drillIn ? 'Clear filters' : t.personal.add
              }
              onAdd={filter || query || tab !== 'all' || drillIn ? clearFilters : addExpense}
            />
          </View>
        }
        ListFooterComponent={
          items.length > 0 ? <View style={{ height: theme.spacing.sm }} /> : null
        }
        renderItem={({ item }) => {
          if (item.kind === 'day') {
            const income = item.net > 0n;
            return (
              <Row
                style={{
                  alignItems: 'center',
                  gap: 8,
                  paddingTop: 16,
                  paddingBottom: 8,
                  paddingHorizontal: 4,
                }}
              >
                <Text
                  style={{ flex: 1, fontSize: 15, fontWeight: '600', color: ink }}
                  numberOfLines={1}
                >
                  {dayLabel(item.day, locale)}
                </Text>
                <View
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 3,
                    borderRadius: 11,
                    backgroundColor: lavender,
                  }}
                >
                  <Text style={{ fontSize: 12, color: muted }}>
                    {plural(locale, item.count, t.personal.txnCount)}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${collapsedDays.has(item.day) ? t.personal.expandDay : t.personal.collapseDay}: ${dayLabel(item.day, locale)}`}
                  accessibilityState={{ expanded: !collapsedDays.has(item.day) }}
                  hitSlop={8}
                  onPress={() =>
                    setCollapsedDays((previous) => {
                      const next = new Set(previous);
                      if (next.has(item.day)) next.delete(item.day);
                      else next.add(item.day);
                      return next;
                    })
                  }
                  style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Ionicons
                    name={collapsedDays.has(item.day) ? 'chevron-down' : 'chevron-up'}
                    size={18}
                    color={muted}
                  />
                </Pressable>
                {item.currency ? (
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: '700',
                      color: item.net === 0n ? muted : income ? INCOME_INK : EXPENSE_INK,
                    }}
                  >
                    {item.net === 0n
                      ? format(money(0n, item.currency), { locale, trimZeros: true })
                      : signed(item.net, item.currency, income)}
                  </Text>
                ) : null}
              </Row>
            );
          }
          const { txn, first, last } = item;
          const income = txn.kind === 'income';
          const categoryLabel = labelFor(txn.category) ?? t.categories.other;
          const title = txn.note?.trim() || categoryLabel;
          const method = txn.paymentMethod
            ? paymentMethodLabel(t.personal.entryScreen.methods, txn.paymentMethod, deviceCountry())
            : null;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${title}, ${categoryLabel}, ${signed(txn.amount, txn.currency, income)}`}
              onPress={() => router.push({ pathname: '/personal/entry', params: { id: txn.id } })}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
                paddingHorizontal: 14,
                paddingVertical: 12,
                backgroundColor: pressed ? theme.color.surfaceMuted : theme.color.surface,
                borderTopLeftRadius: first ? 18 : 0,
                borderTopRightRadius: first ? 18 : 0,
                borderBottomLeftRadius: last ? 18 : 0,
                borderBottomRightRadius: last ? 18 : 0,
                borderTopWidth: first ? 0 : 1,
                borderTopColor: dark ? theme.color.border : '#EFEEF5',
              })}
            >
              <CategoryBadge
                category={txn.category ?? 'other'}
                description={txn.note ?? undefined}
                meta={null}
                size={42}
              />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: ink }} numberOfLines={1}>
                  {title}
                </Text>
                <Text style={{ fontSize: 13, color: muted }} numberOfLines={1}>
                  {categoryLabel}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Text
                  style={{
                    fontSize: 16,
                    fontWeight: '700',
                    color: income ? INCOME_INK : EXPENSE_INK,
                  }}
                >
                  {signed(txn.amount, txn.currency, income)}
                </Text>
                {method ? <Text style={{ fontSize: 12, color: muted }}>{method}</Text> : null}
                {txn.reimbursable ? (
                  <Text style={{ fontSize: 12, color: muted }}>{t.followUps.reimbursableTag}</Text>
                ) : null}
                {txn.receiptKey ? (
                  <Ionicons
                    name="receipt-outline"
                    size={14}
                    color={muted}
                    accessibilityLabel={t.personalReceipt.attached}
                  />
                ) : null}
              </View>
              <Ionicons
                name={directionalIcon('chevron-forward')}
                size={18}
                color={theme.color.textFaint}
              />
            </Pressable>
          );
        }}
      />

      <Sheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        padded={false}
        closeLabel={t.common.close}
        style={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.lg, gap: 14 }}
      >
        <Text style={{ fontSize: 20, fontWeight: '800', color: ink }}>
          {t.personal.filterCategory}
        </Text>
        <CategoryPicker
          wrap
          value={filter}
          onChange={(key) => {
            setPicked(key);
            setFilterOpen(false);
          }}
        />
        {filter ? (
          <Button
            label={t.personal.clearFilter}
            variant="secondary"
            fullWidth
            onPress={() => {
              setPicked(null);
              setFilterOpen(false);
            }}
          />
        ) : null}
      </Sheet>
    </Screen>
  );
}

/** "Thu, 18 September" — the weekday short, the date long, the year only when
 *  it is not this one. Timezone-safe: the ledger's dates are calendar days. */
function dayLabel(day: string, locale: string): string {
  try {
    const sameYear = day.slice(0, 4) === String(new Date().getFullYear());
    return dateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'long',
      ...(sameYear ? {} : { year: 'numeric' }),
      timeZone: 'UTC',
    }).format(new Date(`${day}T00:00:00Z`));
  } catch {
    return day;
  }
}

/**
 * Behind the section shield: one unlock covers the Me tab and every room
 * under `personal/`, so arriving here from the ledger never asks again.
 */
export default function PersonalTransactionsScreen() {
  return (
    <PersonalGuard>
      <PersonalTransactionsScreenBody />
    </PersonalGuard>
  );
}

/** A removable pill naming a narrowing the screen was opened with. */
function FilterChip({
  label,
  clearLabel,
  onClear,
}: {
  label: string;
  clearLabel: string;
  onClear: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${clearLabel}`}
      onPress={onClear}
      hitSlop={6}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        height: 30,
        paddingHorizontal: 12,
        borderRadius: 15,
        backgroundColor: theme.color.brandSoft,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ fontSize: 12, fontWeight: '600', color: theme.color.brand }}>{label}</Text>
      <Ionicons name="close" size={14} color={theme.color.brand} />
    </Pressable>
  );
}
