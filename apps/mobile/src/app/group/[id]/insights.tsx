/**
 * Where the money went (M5, TDR §8).
 *
 * Free and basic on purpose (ADR-011): what each category cost, month by
 * month, for the whole group or for you. Nothing here is a balance and nothing
 * here is settled from — it answers "what are we spending on", which is a
 * different question from "what do I owe" and deserves its own screen rather
 * than another number on the group page.
 *
 * Two things it refuses to do, both inherited from the ledger:
 *
 * It never converts between currencies. An expense in euros and one in rupees
 * are two totals, drawn separately, because there is no honest single figure
 * without a rate somebody chose (ADR-003).
 *
 * It never re-divides an expense. The per-member figures are the shares the
 * ledger stored, odd paisa and all — dividing again here would put a number on
 * screen that no row in the database agrees with.
 */

import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

import {
  categoryTotals,
  computeSpendingRows,
  format,
  formatParts,
  minorUnitExponent,
  monthTotals,
  resolveCategory,
  spendingCurrencies,
  spendingTotal,
  type CategoryId,
} from '@waves/core';
import { EmptyState, iconSize, Row, Text, useTheme } from '@waves/ui';

import { CategoryBadge } from '@/components/Category';
import { ChoiceRow, SheetOverlay } from '@/components/expense/SheetOverlay';
import {
  ListRow,
  PillButton,
  ScenicBody,
  ScenicHeader,
  SectionHeader,
  SegmentedPills,
  StandardCard,
  StatCard,
} from '@/components/standard';
import {
  Donut,
  MonthBars,
  RANK_COLORS,
  REST_COLOR,
  type DonutPart,
} from '@/components/SpendingCharts';
import { InsightsSkeleton } from '@/components/Skeletons';
import type { SpendingRow } from '@/data/api';
import { useGroup } from '@/data/hooks';
import { useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';
import {
  compactNumber,
  donutSlices,
  monthRange,
  percentChange,
  previousMonthKey,
} from '@/lib/spendingChart';
import { isViewer } from '@/data/types';

enum Scope {
  Group = 'group',
  Mine = 'mine',
}

/** The window of months the columns show: six, or a year. */
const MONTH_WINDOWS = [6, 12] as const;

/** Leading categories the donut and its legend name; the rest are one slice. */
const TOP_CATEGORIES = 5;

export default function InsightsScreen() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = id ?? '';

  // Identity for "which member am I", from the session rather than the profile:
  // the session is on the device at launch, the profile is a fetch that lands
  // later, and in the gap `profile?.id` is undefined — which `isViewer` refuses
  // to match, but only if it is given the right thing to compare. See
  // `lib/auth.useViewerId`.
  const viewerId = useViewerId();

  const { group, members, expenses } = useGroup(groupId);

  // Spending is a read of expenses the phone already mirrors, so it is computed
  // on the device (ADR-005) rather than fetched — the local-first twin of the
  // waves_group_spending RPC, same rows, and it works with no connection.
  const spendingRows = useMemo(() => computeSpendingRows(expenses.rows), [expenses.rows]);

  const [scope, setScope] = useState<Scope>(Scope.Group);
  const [pickedCurrency, setPickedCurrency] = useState<string | null>(null);
  const [pickedMonth, setPickedMonth] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'month' | 'currency' | null>(null);

  const myMemberId = useMemo(
    () => (members.data ?? []).find((member) => isViewer(member, viewerId))?.id ?? null,
    [members.data, viewerId],
  );

  // The group's own currency first; anything else follows it, so a single
  // foreign expense never becomes the headline.
  const groupCurrency = group.data?.default_currency ?? 'INR';

  const scoped = useMemo(() => {
    if (scope === Scope.Mine) {
      return myMemberId ? spendingRows.filter((row) => row.member_id === myMemberId) : [];
    }
    return spendingRows;
  }, [spendingRows, scope, myMemberId]);

  // Only currencies with something in them: a currency whose expenses all net
  // to nothing is not a reason to offer a switch.
  const currencies = useMemo(
    () =>
      spendingCurrencies(scoped, groupCurrency).filter(
        (code) => spendingTotal(scoped.filter((row) => row.currency === code)) !== 0n,
      ),
    [scoped, groupCurrency],
  );

  // Never converted: with several currencies, one is shown at a time and every
  // figure on the screen is in it.
  const currency =
    pickedCurrency && currencies.includes(pickedCurrency)
      ? pickedCurrency
      : (currencies[0] ?? groupCurrency);
  const rows = useMemo(() => scoped.filter((row) => row.currency === currency), [scoped, currency]);

  // Every month with spending, oldest first (a limit beyond any real history).
  const allMonths = useMemo(() => monthTotals(rows, 1200), [rows]);
  const latest = allMonths[allMonths.length - 1]?.month ?? null;
  const month =
    pickedMonth && allMonths.some((entry) => entry.month === pickedMonth) ? pickedMonth : latest;

  const loading = group.isLoading || members.isLoading || expenses.isLoading;
  const empty = !loading && currencies.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: clearance }}
        showsVerticalScrollIndicator={false}
      >
        <ScenicHeader title={t.spending}>
          <SegmentedPills<Scope>
            value={scope}
            onChange={setScope}
            options={[
              { value: Scope.Group, label: t.extras.theGroup },
              { value: Scope.Mine, label: t.extras.justMe },
            ]}
          />
          <View style={{ flex: 1 }} />
          {month ? (
            <PillButton
              icon="calendar-outline"
              label={monthLabel(month, locale, true)}
              accessibilityLabel={`${t.spendPickMonth}: ${monthLabel(month, locale, true)}`}
              onPress={() => setSheet('month')}
            />
          ) : null}
        </ScenicHeader>

        <ScenicBody>
          {loading ? (
            <InsightsSkeleton />
          ) : empty || !month ? (
            <EmptyState title={t.nothingYet} body={t.nothingToChart} />
          ) : (
            <SpendingBody
              groupId={groupId}
              scope={scope}
              currency={currency}
              hasSeveralCurrencies={currencies.length > 1}
              onPickCurrency={() => setSheet('currency')}
              locale={locale}
              rows={rows}
              allMonths={allMonths}
              month={month}
              onSelectMonth={setPickedMonth}
              labels={t.categories}
            />
          )}
        </ScenicBody>
      </ScrollView>

      {sheet === 'month' ? (
        <SheetOverlay title={t.spendPickMonth} onClose={() => setSheet(null)}>
          {[...allMonths].reverse().map((entry) => (
            <ChoiceRow
              key={entry.month}
              leading={
                <Ionicons
                  name="calendar-outline"
                  size={iconSize.md}
                  color={theme.color.textMuted}
                />
              }
              label={monthLabel(entry.month, locale, true)}
              selected={entry.month === month}
              onPress={() => {
                setPickedMonth(entry.month);
                setSheet(null);
              }}
            />
          ))}
        </SheetOverlay>
      ) : null}
      {sheet === 'currency' ? (
        <SheetOverlay title={t.spendPickCurrency} onClose={() => setSheet(null)}>
          {currencies.map((code) => (
            <ChoiceRow
              key={code}
              leading={
                <Ionicons name="cash-outline" size={iconSize.md} color={theme.color.textMuted} />
              }
              label={code}
              selected={code === currency}
              onPress={() => {
                setPickedCurrency(code);
                setSheet(null);
              }}
            />
          ))}
        </SheetOverlay>
      ) : null}
    </View>
  );
}

function SpendingBody({
  groupId,
  scope,
  currency,
  hasSeveralCurrencies,
  onPickCurrency,
  locale,
  rows,
  allMonths,
  month,
  onSelectMonth,
  labels,
}: {
  groupId: string;
  scope: Scope;
  currency: string;
  hasSeveralCurrencies: boolean;
  onPickCurrency: () => void;
  locale: string;
  rows: SpendingRow[];
  allMonths: { month: string; value: bigint }[];
  month: string;
  onSelectMonth: (month: string) => void;
  labels: Record<CategoryId, string>;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const { width: windowWidth } = useWindowDimensions();
  const [windowSize, setWindowSize] = useState<(typeof MONTH_WINDOWS)[number]>(6);
  const [windowOpen, setWindowOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const exponent = minorUnitExponent(currency);
  const toMajor = (minor: bigint) => Number(minor) / 10 ** exponent;
  const money = (minor: bigint) => format({ minor, currency }, { locale });
  // The currency's own symbol, as the locale prints it (₹, $, €).
  const symbol = formatParts({ minor: 0n, currency }, { locale }).lead.replace(/[\d\s.,٠-٩]/g, '');

  // The month on show: its rows, its total, and how it compares with the month before.
  const monthRows = useMemo(() => rows.filter((row) => row.month === month), [rows, month]);
  const total = spendingTotal(monthRows);
  const previous =
    allMonths.find((entry) => entry.month === previousMonthKey(month))?.value ?? null;
  const change = percentChange(total, previous);
  const totalParts = formatParts({ minor: total, currency }, { locale });

  // The bucketing is `categoryTotals` in @waves/core — shared with the browser,
  // which draws the same chart. What is left here is naming and drawing: a
  // custom tag names itself, a built-in is named through the table.
  const categories = categoryTotals(monthRows).map(({ key, category, meta, value }) => {
    const resolved = resolveCategory(category, meta);
    return {
      key,
      category,
      meta,
      value,
      label: resolved.custom ? resolved.label : labels[resolved.builtinId ?? 'other'],
      tint: resolved.tint,
      percent: total > 0n ? Math.round((Number(value) / Number(total)) * 100) : 0,
    };
  });

  const slices = (() => {
    const lead = categories.slice(0, TOP_CATEGORIES);
    const rest = categories.slice(TOP_CATEGORIES).reduce((sum, entry) => sum + entry.value, 0n);
    const parts: { item: DonutPart; value: number }[] = lead.map((entry, index) => ({
      item: { key: entry.key, color: RANK_COLORS[index] },
      value: Number(entry.value),
    }));
    if (rest > 0n) parts.push({ item: { key: 'rest', color: null }, value: Number(rest) });
    return donutSlices(parts, Number(total));
  })();

  // Every slot of the window is drawn, spending or not: a month with nothing
  // in it is a gap in the row, not a missing column.
  const byMonth = new Map(allMonths.map((entry) => [entry.month, entry.value]));
  const newest = allMonths[allMonths.length - 1]?.month ?? month;
  const bars = monthRange(newest, windowSize).map((key) => {
    const value = byMonth.get(key) ?? 0n;
    return {
      key,
      label: monthLabel(key, locale),
      value: toMajor(value),
      description: `${monthLabel(key, locale)}: ${money(value)}`,
    };
  });
  // The trend ends on the month on show, six months back from it.
  const trend = monthRange(month, 6).map((key) => toMajor(byMonth.get(key) ?? 0n));

  // The ring takes about 38% of the card's inner width (screen minus the page
  // and card padding), so the legend keeps room for a whole name, amount and %.
  const inner = windowWidth - theme.spacing.lg * 4;
  const donutSize = Math.min(150, Math.max(120, Math.round(inner * 0.38)));

  const legend = showAll ? categories : categories.slice(0, TOP_CATEGORIES);
  const topList = showAll ? categories : categories.slice(0, TOP_CATEGORIES);
  // "See all" is offered only when there is more than the five shown.
  const seeAll =
    categories.length > TOP_CATEGORIES
      ? {
          label: showAll ? t.spendShowLess : t.spendSeeAll,
          onPress: () => setShowAll((v) => !v),
        }
      : undefined;

  return (
    <>
      <StatCard
        label={t.spendTotal}
        lead={totalParts.lead}
        fraction={`${totalParts.fraction}${totalParts.trail}`}
        accessibilityLabel={`${t.spendTotal}: ${money(total)}`}
        caption={
          hasSeveralCurrencies ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t.spendPickCurrency}: ${currency}`}
              onPress={onPickCurrency}
              hitSlop={8}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                alignSelf: 'flex-start',
              }}
            >
              <Text variant="caption" tone="brand" style={{ fontWeight: '600' }}>
                {t.spendInCurrency.replace('{currency}', currency)}
              </Text>
              <Ionicons name="chevron-down" size={iconSize.sm} color={theme.color.brand} />
            </Pressable>
          ) : (
            <Text variant="caption" tone="muted">
              {t.spendInCurrency.replace('{currency}', currency)}
            </Text>
          )
        }
        delta={change !== null ? { percent: change, caption: t.spendVsLast } : undefined}
        trend={trend}
      />

      <View style={{ gap: theme.spacing.md }}>
        <SectionHeader title={t.byCategory} action={seeAll} />
        <StandardCard>
          <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
            <Donut
              size={donutSize}
              slices={slices}
              centre={`${symbol}${compactNumber(toMajor(total))}`}
              caption={t.spendDonutTotal}
            />
            <View style={{ flex: 1, minHeight: donutSize, justifyContent: 'space-evenly' }}>
              {legend.map((entry, index) => (
                <Row
                  key={entry.key}
                  accessible
                  accessibilityLabel={`${entry.label}, ${money(entry.value)}, ${entry.percent}%`}
                  style={{ alignItems: 'center', gap: 5 }}
                >
                  <CategoryBadge
                    category={entry.category}
                    meta={entry.meta}
                    size={28}
                    accent={RANK_COLORS[index] ?? REST_COLOR}
                  />
                  <Text
                    variant="micro"
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.85}
                    style={{ flex: 1 }}
                  >
                    {entry.label}
                  </Text>
                  <Text variant="micro" numberOfLines={1} tabular style={{ fontWeight: '600' }}>
                    {money(entry.value)}
                  </Text>
                  <Text variant="micro" tone="muted" style={{ width: 24, textAlign: 'right' }}>
                    {`${entry.percent}%`}
                  </Text>
                </Row>
              ))}
            </View>
          </Row>
        </StandardCard>
      </View>

      <View style={{ gap: theme.spacing.md }}>
        <SectionHeader
          title={t.byMonth}
          trailing={
            <View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.spendLastMonths.replace('{n}', String(windowSize))}
                onPress={() => setWindowOpen((open) => !open)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.xs,
                  height: 34,
                  paddingHorizontal: theme.spacing.md,
                  borderRadius: theme.radius.pill,
                  backgroundColor: theme.color.surface,
                  ...theme.shadow.soft,
                }}
              >
                <Text variant="caption" tone="muted">
                  {t.spendLastMonths.replace('{n}', String(windowSize))}
                </Text>
                <Ionicons
                  name={windowOpen ? 'chevron-up' : 'chevron-down'}
                  size={iconSize.sm}
                  color={theme.color.textMuted}
                />
              </Pressable>
            </View>
          }
        />
        {windowOpen ? (
          <Row style={{ justifyContent: 'flex-end', gap: theme.spacing.sm }}>
            {MONTH_WINDOWS.map((size) => (
              <Pressable
                key={size}
                accessibilityRole="button"
                accessibilityState={{ selected: size === windowSize }}
                onPress={() => {
                  setWindowSize(size);
                  setWindowOpen(false);
                }}
                style={{
                  height: 32,
                  paddingHorizontal: theme.spacing.md,
                  borderRadius: theme.radius.pill,
                  justifyContent: 'center',
                  backgroundColor:
                    size === windowSize ? theme.color.buttonPrimary : theme.color.surface,
                }}
              >
                <Text
                  variant="caption"
                  style={{
                    color:
                      size === windowSize ? theme.color.onButtonPrimary : theme.color.textMuted,
                  }}
                >
                  {t.spendLastMonths.replace('{n}', String(size))}
                </Text>
              </Pressable>
            ))}
          </Row>
        ) : null}
        <StandardCard style={{ gap: theme.spacing.md }}>
          <MonthBars data={bars} selected={month} onSelect={onSelectMonth} symbol={symbol} />
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.push(
                `/group/${groupId}/month?month=${month}&currency=${currency}&scope=${scope}`,
              )
            }
            style={{ alignSelf: 'center' }}
          >
            <Text variant="caption" tone="brand" style={{ fontWeight: '600' }}>
              {t.spendSeeDays.replace('{month}', monthLabel(month, locale))}
            </Text>
          </Pressable>
        </StandardCard>
      </View>

      <View style={{ gap: theme.spacing.md }}>
        <SectionHeader title={t.spendTopCategories} action={seeAll} />
        <StandardCard style={{ gap: theme.spacing.md }}>
          {topList.map((entry, index) => (
            <ListRow
              key={entry.key}
              leading={
                <CategoryBadge
                  category={entry.category}
                  meta={entry.meta}
                  size={28}
                  accent={RANK_COLORS[index] ?? REST_COLOR}
                />
              }
              title={entry.label}
              amount={money(entry.value)}
              percent={entry.percent}
              footer={
                <View
                  style={{ height: 5, borderRadius: 3, backgroundColor: theme.color.surfaceMuted }}
                >
                  <View
                    style={{
                      width: `${Math.max(entry.percent, 2)}%`,
                      height: 5,
                      borderRadius: 3,
                      backgroundColor: RANK_COLORS[index] ?? REST_COLOR,
                      opacity: 0.6,
                    }}
                  />
                </View>
              }
            />
          ))}
        </StandardCard>
      </View>
    </>
  );
}

/** 'Mar' (or 'Mar 2026' with `withYear`) from '2026-03-01', without letting a timezone move it. */
function monthLabel(month: string, locale: string, withYear = false): string {
  // The month is a plain 'YYYY-MM-DD' from Postgres. Reading it with
  // `new Date(...)` would apply the phone's timezone and, east of UTC,
  // label January as December.
  const [year, monthNumber] = month.split('-');
  const date = new Date(Date.UTC(Number(year), Number(monthNumber) - 1, 1));
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(date);
}
