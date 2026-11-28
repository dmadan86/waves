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
import { Pressable, ScrollView, View } from 'react-native';

import { LIST_TILE, ListItem } from '@/components/standard/ListItem';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HEADER_BUTTON } from '@/components/standard/HeaderBar';
import { PlainHeader } from '@/components/standard/PlainHeader';
import { SummaryCard } from '@/components/standard/SummaryCard';

import {
  format,
  isInvestmentCategory,
  money,
  monthlyIncomeEntries,
  resolveCategory,
  type PersonalTxn,
} from '@waves/core';
import { localMonth } from '@/lib/expenseForm';
import { Button, iconSize, Row, Screen, Sheet, Text, useTheme } from '@waves/ui';

import { EmptyStateCta } from '@/components/EmptyStateCta';
import { personalTxnCategoryLabel } from '@/lib/personalTxnCategoryLabel';
import { filterTxns, groupByDay, monthSummary, type TxnTab } from '@/lib/txnLedger';
import { CategoryBadge, CategoryPicker } from '@/components/Category';
import { usePersonalLedger, useUpsertPersonalRecord } from '@/data/personal';
import { entryRecord } from '@/lib/personalEntry';
import { monthlySpendEntries } from '@/lib/monthlySpend';
import { deviceCountry, useStrings } from '@/i18n';
import { paymentMethodLabel } from '@/lib/paymentMethodLabel';
import { PersonalGuard } from '@/components/PersonalGuard';
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
  const insets = useSafeAreaInsets();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const { txns } = usePersonalLedger();
  const dark = theme.scheme === 'dark';
  const ink = dark ? theme.color.text : SPEC_INK;
  const muted = dark ? theme.color.textMuted : SPEC_MUTED;
  const accent = dark ? theme.color.brand : SPEC_ACCENT;
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
  const [monthOpen, setMonthOpen] = useState(false);
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
  // Uncategorized view: the row being given a category, in the same picker sheet.
  const [categorizing, setCategorizing] = useState<PersonalTxn | null>(null);
  const upsert = useUpsertPersonalRecord();
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

  // Icon-only, so the four type chips beside it keep their full labels.
  const filterChip = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t.personal.filterLabel}
      accessibilityState={{ selected: filter !== null }}
      onPress={() => setFilterOpen(true)}
      style={{
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 18,
        backgroundColor: filter ? accent : theme.color.surface,
      }}
    >
      <Ionicons name="funnel-outline" size={16} color={filter ? '#FFFFFF' : ink} />
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
    icon?: keyof typeof Ionicons.glyphMap;
    color: string;
  }[] = [
    { value: 'all', label: t.personal.all, color: accent },
    { value: 'expense', label: t.personal.expenses, icon: 'arrow-up', color: EXPENSE_INK },
    { value: 'income', label: t.personal.income, icon: 'arrow-down', color: INCOME_INK },
    { value: 'transfer', label: t.personal.transfers, icon: 'swap-horizontal', color: accent },
  ];

  const summary = monthEnabled ? monthSummary(txns, browseMonth) : null;
  const fmt = (amount: bigint, currency: string) =>
    format(money(amount < 0n ? -amount : amount, currency), { locale, trimZeros: true });
  const months = useMemo(() => {
    const now = localMonth();
    const list = Array.from({ length: 12 }, (_, i) => shiftMonth(now, -i));
    return list.includes(browseMonth) ? list : [browseMonth, ...list];
  }, [browseMonth]);

  const roundButton = (
    label: string,
    icon: keyof typeof Ionicons.glyphMap,
    onPress: () => void,
    filled = false,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        width: HEADER_BUTTON,
        height: HEADER_BUTTON,
        borderRadius: HEADER_BUTTON / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: filled ? accent : theme.color.surfaceMuted,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Ionicons name={icon} size={iconSize.lg} color={filled ? '#FFFFFF' : ink} />
    </Pressable>
  );
  // Three round actions: HeaderBar's `action` slot takes any node, so no change there.
  const actions = (
    <>
      {roundButton(t.personal.searchTransactions, 'search', () => setSearch(openHeaderSearch))}
      {/* The assistant, already pointed at the private ledger: what is said or
                typed there stays personal. */}
      {roundButton(t.personal.askByVoice, 'mic-outline', () =>
        router.push({ pathname: '/voice', params: { scope: 'personal', source: 'personal' } }),
      )}
      {roundButton(t.personal.addTransaction, 'add', addExpense, true)}
    </>
  );

  const rangeLabel =
    fromDate && toDate ? (fromDate === toDate ? fromDate : `${fromDate} – ${toDate}`) : null;
  const subtitle =
    [filter ? (labelFor(filter) ?? filter) : null, rangeLabel].filter(Boolean).join(' · ') ||
    t.personal.transactionsSubtitle;

  return (
    <Screen edges={[]}>
      {search.open ? (
        <View
          style={{
            paddingHorizontal: theme.spacing.lg,
            paddingTop: insets.top + theme.spacing.sm,
            paddingBottom: theme.spacing.sm,
          }}
        >
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
        </View>
      ) : (
        <PlainHeader
          title={t.personal.transactions}
          subtitle={subtitle}
          hideBack={!drillIn}
          onBack={() =>
            params.returnTo && !router.canGoBack()
              ? router.replace(params.returnTo as never)
              : router.back()
          }
          trailing={<Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>{actions}</Row>}
        />
      )}
      <View style={{ paddingHorizontal: theme.spacing.lg, gap: 10 }}>
        <SummaryCard
          title={monthEnabled ? monthLabel(browseMonth, locale) : t.group.allMonths}
          titleHint={`${t.personal.chooseMonth}: ${monthEnabled ? monthLabel(browseMonth, locale) : t.group.allMonths}`}
          onTitlePress={() => setMonthOpen(true)}
          money={{
            label: t.personal.income,
            value: summary ? fmt(summary.income, summary.currency) : '',
          }}
          expense={{
            label: t.personal.expenses,
            value: summary ? fmt(summary.expense, summary.currency) : '',
          }}
          net={{
            label: t.personal.net,
            value: summary
              ? `${summary.net < 0n ? '-' : ''}${fmt(summary.net, summary.currency)}`
              : '',
          }}
          negative={(summary?.net ?? 0n) < 0n}
          footnote={summary && summary.otherCurrencies > 0 ? t.personal.otherCurrencies : undefined}
        />

        <Row style={{ alignItems: 'center', gap: 8 }}>
          <ScrollView
            horizontal
            accessibilityRole="tablist"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 6, alignItems: 'center' }}
            style={{ flex: 1 }}
          >
            {tabs.map((item) => {
              const on = item.value === tab;
              return (
                <Pressable
                  key={item.value}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  onPress={() => setTab(item.value)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    height: 34,
                    paddingHorizontal: 12,
                    borderRadius: 17,
                    backgroundColor: on ? accent : theme.color.surface,
                    borderWidth: on ? 0 : 1,
                    borderColor: theme.color.border,
                  }}
                >
                  {item.icon ? (
                    <Ionicons name={item.icon} size={14} color={on ? '#FFFFFF' : item.color} />
                  ) : null}
                  <Text
                    style={{
                      fontSize: 13,
                      fontWeight: on ? '700' : '500',
                      color: on ? '#FFFFFF' : ink,
                    }}
                    numberOfLines={1}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {filterChip}
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
                  ? t.personal.noEntriesMatch
                  : t.personal.noEntriesIn.replace('{month}', monthLabel(browseMonth, locale))
              }
              body={
                filter || query || tab !== 'all' || drillIn
                  ? t.personal.noEntriesForFilter.replace(
                      '{month}',
                      monthEnabled ? monthLabel(browseMonth, locale) : t.group.allMonths,
                    )
                  : t.personal.transactionsSubtitle
              }
              action={
                filter || query || tab !== 'all' || drillIn
                  ? t.personal.clearFilters
                  : t.personal.add
              }
              actionIcon={filter || query || tab !== 'all' || drillIn ? null : 'add'}
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
            const collapsed = collapsedDays.has(item.day);
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${collapsed ? t.personal.expandDay : t.personal.collapseDay}: ${dayLabel(item.day, locale)}`}
                accessibilityState={{ expanded: !collapsed }}
                onPress={() =>
                  setCollapsedDays((previous) => {
                    const next = new Set(previous);
                    if (next.has(item.day)) next.delete(item.day);
                    else next.add(item.day);
                    return next;
                  })
                }
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                  marginTop: theme.spacing.md,
                  paddingVertical: theme.spacing.sm,
                  paddingHorizontal: theme.spacing.md,
                  backgroundColor: dark ? theme.color.surfaceMuted : `${accent}14`,
                  borderWidth: 1,
                  borderBottomWidth: collapsed ? 1 : 0,
                  borderColor: theme.color.border,
                  borderTopStartRadius: theme.radius.lg,
                  borderTopEndRadius: theme.radius.lg,
                  borderBottomStartRadius: collapsed ? theme.radius.lg : 0,
                  borderBottomEndRadius: collapsed ? theme.radius.lg : 0,
                }}
              >
                <Text
                  style={{ flex: 1, fontSize: 14, fontWeight: '700', color: ink }}
                  numberOfLines={1}
                >
                  {dayLabel(item.day, locale)}
                </Text>
                {item.currency ? (
                  <Text
                    style={{
                      fontSize: 14,
                      fontWeight: '700',
                      color: item.net === 0n ? muted : income ? INCOME_INK : EXPENSE_INK,
                    }}
                  >
                    {item.net === 0n
                      ? format(money(0n, item.currency), { locale, trimZeros: true })
                      : signed(item.net, item.currency, income)}
                  </Text>
                ) : null}
                <Ionicons
                  name={collapsed ? 'chevron-down' : 'chevron-up'}
                  size={18}
                  color={muted}
                />
              </Pressable>
            );
          }
          const { txn, last } = item;
          const income = txn.kind === 'income';
          const categoryLabel = labelFor(txn.category) ?? t.categories.other;
          const title = txn.note?.trim() || categoryLabel;
          const method = txn.paymentMethod
            ? paymentMethodLabel(t.personal.entryScreen.methods, txn.paymentMethod, deviceCountry())
            : null;
          const caption = [method, txn.reimbursable ? t.followUps.reimbursableTag : null]
            .filter(Boolean)
            .join(' · ');
          return (
            <ListItem
              accessibilityLabel={`${title}, ${categoryLabel}, ${signed(txn.amount, txn.currency, income)}`}
              onPress={() =>
                uncategorizedOnly
                  ? setCategorizing(txn)
                  : router.push({ pathname: '/personal/entry', params: { id: txn.id } })
              }
              position={last ? 'last' : 'middle'}
              leading={
                <CategoryBadge
                  category={txn.category ?? 'other'}
                  description={txn.note ?? undefined}
                  meta={null}
                  size={LIST_TILE}
                />
              }
              title={title}
              titleAccessory={
                txn.receiptKey ? (
                  <Ionicons
                    name="receipt-outline"
                    size={14}
                    color={muted}
                    accessibilityLabel={t.personalReceipt.attached}
                  />
                ) : undefined
              }
              subtitle={categoryLabel}
              amount={signed(txn.amount, txn.currency, income)}
              amountColor={income ? INCOME_INK : EXPENSE_INK}
              caption={caption || undefined}
              chevron
            />
          );
        }}
      />

      <Sheet visible={monthOpen} onClose={() => setMonthOpen(false)} closeLabel={t.common.close}>
        <Text style={{ fontSize: 20, fontWeight: '800', color: ink }}>
          {t.personal.chooseMonth}
        </Text>
        {[...months, null].map((m) => {
          const on = m === null ? !monthEnabled : monthEnabled && m === browseMonth;
          return (
            <Pressable
              key={m ?? 'all'}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => {
                setMonthEnabled(m !== null);
                if (m) setBrowseMonth(m);
                setMonthOpen(false);
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                height: 44,
              }}
            >
              <Text
                style={{ fontSize: 16, fontWeight: on ? '700' : '500', color: on ? accent : ink }}
              >
                {m ? monthLabel(m, locale) : t.group.allMonths}
              </Text>
              {on ? <Ionicons name="checkmark" size={20} color={accent} /> : null}
            </Pressable>
          );
        })}
      </Sheet>
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
      <Sheet
        visible={categorizing !== null}
        onClose={() => setCategorizing(null)}
        padded={false}
        closeLabel={t.common.close}
        style={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.lg, gap: 14 }}
      >
        <Text style={{ fontSize: 20, fontWeight: '800', color: ink }}>
          {t.personalHome.categorize}
        </Text>
        <CategoryPicker
          wrap
          value={null}
          onChange={(key) => {
            const txn = categorizing;
            setCategorizing(null);
            if (!txn) return;
            // Same record the entry form writes, only the category changed; the row
            // then no longer matches Uncategorized and leaves the list.
            upsert.mutate(
              entryRecord({ ...txn, category: key, note: txn.note ?? null }, null, { txn }),
            );
          }}
        />
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
