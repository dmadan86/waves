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
 * the person and a loan rather than spent or earned.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { format, money, resolveCategory, type PersonalTxn } from '@waves/core';
import {
  Button,
  directionalIcon,
  EmptyState,
  IconButton,
  iconSize,
  Row,
  Screen,
  Sheet,
  Text,
  useTheme,
} from '@waves/ui';

import { CategoryBadge, CategoryPicker } from '@/components/Category';
import { usePersonalLedger } from '@/data/personal';
import { plural, useStrings } from '@/i18n';
import { PersonalGuard } from '@/components/PersonalGuard';
import { useBottomClearance } from '@/lib/clearance';
import { dateTimeFormat } from '@/lib/dateTimeFormat';
import { router } from '@/lib/navigation';
import { SPEC_ACCENT, SPEC_INK, SPEC_MUTED } from '@/lib/specPalette';

type Tab = 'all' | 'expense' | 'income' | 'transfer';

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
  }>();
  const paramCategory = typeof params.category === 'string' ? params.category : null;
  // The dashboard's columns are buckets: a custom or unknown category is counted
  // under Other there, so it has to be listed under Other here too. Budgets pass
  // an exact id, custom ones included, and keep matching it exactly.
  const bucketed = params.categoryMode === 'bucket';
  const kindParam = params.kind === 'income' || params.kind === 'expense' ? params.kind : null;
  const month =
    typeof params.month === 'string' && /^\d{4}-\d{2}$/.test(params.month) ? params.month : null;

  const [tab, setTab] = useState<Tab>(kindParam ?? 'all');
  const [query, setQuery] = useState('');
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
    const needle = query.trim().toLocaleLowerCase(locale);
    const matchesQuery = (txn: PersonalTxn): boolean => {
      if (!needle) return true;
      const label = txn.category
        ? (t.categories[txn.category as keyof typeof t.categories] ?? txn.category)
        : '';
      return [txn.note ?? '', label, format(money(txn.amount, txn.currency), { locale })].some(
        (text) => text.toLocaleLowerCase(locale).includes(needle),
      );
    };
    const matchesTab = (txn: PersonalTxn): boolean =>
      tab === 'all'
        ? true
        : tab === 'transfer'
          ? txn.loanId !== null
          : txn.kind === tab && txn.loanId === null;
    const shown = txns.filter(
      (txn) =>
        matchesCategory(txn.category) &&
        matchesTab(txn) &&
        matchesQuery(txn) &&
        (!month || txn.date.slice(0, 7) === month),
    );

    const list: LedgerItem[] = [];
    for (let index = 0; index < shown.length;) {
      const day = shown[index]!.date;
      let end = index;
      while (end < shown.length && shown[end]!.date === day) end += 1;
      const rows = shown.slice(index, end);
      const currency = rows[0]!.currency;
      // The day's net, in the day's first currency; a day that mixes currencies
      // shows no total rather than a sum of unlike things.
      const mixed = rows.some((row) => row.currency !== currency);
      const net = mixed
        ? 0n
        : rows.reduce((sum, row) => sum + (row.kind === 'income' ? row.amount : -row.amount), 0n);
      list.push({
        kind: 'day',
        key: `day-${day}`,
        day,
        count: rows.length,
        net,
        currency: mixed ? '' : currency,
      });
      rows.forEach((txn, at) =>
        list.push({ kind: 'txn', key: txn.id, txn, first: at === 0, last: at === rows.length - 1 }),
      );
      index = end;
    }
    return list;
  }, [txns, filter, picked, bucketed, month, tab, query, locale, t]);

  const signed = (amount: bigint, currency: string, income: boolean): string =>
    `${income ? '+' : '-'}${format(money(amount < 0n ? -amount : amount, currency), { locale })}`;

  const tabs: { value: Tab; label: string }[] = [
    { value: 'all', label: t.personal.all },
    { value: 'expense', label: t.personal.expenses },
    { value: 'income', label: t.personal.income },
    { value: 'transfer', label: t.personal.transfers },
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
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons name={directionalIcon('chevron-back')} size={iconSize.lg} color={ink} />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          {/* The category's own name is the title when one is being shown, so
              the screen says what it is a list *of* rather than leaving the
              person to wonder where the rest of their ledger went. */}
          <Text style={{ fontSize: 20, fontWeight: '700', color: ink }} numberOfLines={1}>
            {(filter ? labelFor(filter) : null) ?? t.personal.transactions}
          </Text>
          {month ? (
            <Text style={{ fontSize: 12, color: muted }} numberOfLines={1}>
              {monthName(month, locale)}
            </Text>
          ) : null}
        </View>
        <IconButton
          label={t.personal.add}
          onPress={() => router.push({ pathname: '/personal/entry', params: { kind: 'expense' } })}
        >
          <Ionicons name="add" size={iconSize.xxl} color={accent} />
        </IconButton>
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

        <Row
          accessibilityRole="tablist"
          style={{ padding: 4, borderRadius: 24, backgroundColor: lavender, gap: 2 }}
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
                  flex: 1,
                  height: 36,
                  borderRadius: 18,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: on ? accent : 'transparent',
                }}
              >
                <Text
                  style={{
                    fontSize: 14,
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
          paddingBottom: clearance,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={{ paddingTop: theme.spacing.xxxl }}>
            <EmptyState title={t.personal.empty} />
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
                {item.currency ? (
                  <Text
                    style={{
                      fontSize: 15,
                      fontWeight: '700',
                      color: income ? INCOME_INK : EXPENSE_INK,
                    }}
                  >
                    {signed(item.net, item.currency, income)}
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
