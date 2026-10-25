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
import { Pressable, TextInput, View } from 'react-native';

import { format, money, resolveCategory, type PersonalTxn } from '@waves/core';
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
import { filterTxns, groupByDay, type TxnTab } from '@/lib/txnLedger';
import { CategoryBadge, CategoryPicker } from '@/components/Category';
import { usePersonalLedger } from '@/data/personal';
import { plural, useStrings } from '@/i18n';
import { PersonalGuard } from '@/components/PersonalGuard';
import { useBottomClearance } from '@/lib/clearance';
import { dateTimeFormat } from '@/lib/dateTimeFormat';
import { router } from '@/lib/navigation';
import { SPEC_ACCENT, SPEC_INK, SPEC_MUTED } from '@/lib/specPalette';

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
    from?: string;
    to?: string;
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

  const [tab, setTab] = useState<Tab>(kindParam ?? 'all');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(timer);
  }, [query]);
  const drillIn = [params.category, params.kind, params.month, params.from, params.to].some(
    (value) => value !== undefined,
  );
  const addExpense = () =>
    router.push({ pathname: '/personal/entry', params: { kind: 'expense' } });
  // The filter sheet's pick replaces the one the screen was opened with.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);
  const filter = picked === undefined ? paramCategory : picked;

  const labelFor = (id: string | null): string | null =>
    id ? (t.categories[id as keyof typeof t.categories] ?? null) : null;

  /**
   * Grouped by day, flattened into one recyclable list — a heading item where
   * the day changes, then its entries. The ledger already comes newest first,
   * so days do too. FlashList recycles each kind against its own pool, the way
   * the group month screen does.
   */
  const items: LedgerItem[] = useMemo(() => {
    const matchesCategory = (category: string | null | undefined): boolean =>
      !filter ||
      (bucketed && picked === undefined
        ? (resolveCategory(category ?? null, null).builtinId ?? 'other') === filter
        : category === filter);
    const shown = filterTxns(txns, {
      tab,
      needle: debouncedQuery,
      locale,
      categoryMatch: matchesCategory,
      categoryLabel: (id) => t.categories[id as keyof typeof t.categories] ?? id,
      month,
      from: fromDate,
      to: toDate,
    });
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
    txns,
    filter,
    picked,
    bucketed,
    month,
    fromDate,
    toDate,
    tab,
    debouncedQuery,
    locale,
    t,
    collapsedDays,
  ]);

  const signed = (amount: bigint, currency: string, income: boolean): string =>
    `${income ? '+' : '-'}${format(money(amount < 0n ? -amount : amount, currency), { locale })}`;

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
      <Row
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.sm,
          alignItems: 'center',
        }}
      >
        {drillIn ? (
          <IconButton label={t.common.back} onPress={() => router.back()}>
            <Ionicons name={directionalIcon('chevron-back')} size={iconSize.lg} color={ink} />
          </IconButton>
        ) : null}
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text style={{ fontSize: 28, fontWeight: '800', color: ink }}>
            {t.personal.transactions}
          </Text>
          <Text style={{ fontSize: 12, color: muted }}>{t.personal.transactionsSubtitle}</Text>
          {filter ? (
            <Text style={{ fontSize: 12, color: muted }}>{labelFor(filter) ?? filter}</Text>
          ) : null}
          {fromDate && toDate ? (
            <Text style={{ fontSize: 12, color: muted }} numberOfLines={1}>
              {fromDate === toDate ? fromDate : `${fromDate} – ${toDate}`}
            </Text>
          ) : null}
          {month ? (
            <Text style={{ fontSize: 12, color: muted }} numberOfLines={1}>
              {monthName(month, locale)}
            </Text>
          ) : null}
        </View>
        {/* The assistant, already pointed at the private ledger: what is said or
            typed there stays personal. */}
        <IconButton
          label={t.assistant.openPersonalAssistant}
          onPress={() =>
            router.push({ pathname: '/voice', params: { scope: 'personal', source: 'personal' } })
          }
        >
          <Ionicons name="sparkles-outline" size={iconSize.xl} color={accent} />
        </IconButton>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.personal.add}
          onPress={addExpense}
          hitSlop={4}
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: accent,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Ionicons name="add" size={26} color="#FFFFFF" />
        </Pressable>
      </Row>

      <View style={{ paddingHorizontal: theme.spacing.lg, gap: 10, paddingTop: 6 }}>
        <Row style={{ alignItems: 'center', gap: 10 }}>
          <Row
            style={{
              flex: 1,
              alignItems: 'center',
              gap: 10,
              height: 44,
              paddingHorizontal: 14,
              borderRadius: 22,
              backgroundColor: lavender,
            }}
          >
            <Ionicons name="search" size={18} color={muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t.personal.searchTransactions}
              placeholderTextColor={muted}
              accessibilityLabel={t.personal.searchTransactions}
              returnKeyType="search"
              autoCorrect={false}
              style={{ flex: 1, fontSize: 15, color: ink, paddingVertical: 0 }}
            />
            {query ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.entry.clear}
                onPress={() => setQuery('')}
                hitSlop={8}
              >
                <Ionicons name="close-circle" size={18} color={theme.color.textFaint} />
              </Pressable>
            ) : null}
          </Row>
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
              shadowColor: '#2A1E6B',
              shadowOpacity: dark ? 0 : 0.08,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 2 },
              elevation: 2,
            })}
          >
            <Ionicons name="filter" size={20} color={filter ? '#FFFFFF' : ink} />
          </Pressable>
        </Row>

        <Row accessibilityRole="tablist" style={{ gap: 5 }}>
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
                  backgroundColor: on ? accent : theme.color.surface,
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
          paddingBottom: clearance + 96,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={{ paddingTop: theme.spacing.xxxl }}>
            <EmptyStateCta
              title={t.personal.empty}
              body={t.personal.transactionsSubtitle}
              action={t.personal.add}
              onAdd={addExpense}
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
                      ? format(money(0n, item.currency), { locale })
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
            ? t.personal.entryScreen.methods[
                txn.paymentMethod as keyof typeof t.personal.entryScreen.methods
              ]
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

/** A month as "September 2026" for the line under the title, timezone-safe. */
function monthName(month: string, locale: string): string {
  try {
    return dateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${month}-01T00:00:00Z`),
    );
  } catch {
    return month;
  }
}
