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
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams } from 'expo-router';
import { Image, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
import { Card, directionalIcon, EmptyState, iconSize, Row, Text, useTheme } from '@waves/ui';

import { CategoryBadge } from '@/components/Category';
import { ChoiceRow, SheetOverlay } from '@/components/expense/SheetOverlay';
import { useHeroStatusBar } from '@/components/ScreenHero';
import {
  Donut,
  MonthBars,
  RANK_COLORS,
  REST_COLOR,
  Sparkline,
  type DonutPart,
} from '@/components/SpendingCharts';
import { InsightsSkeleton } from '@/components/Skeletons';
import type { SpendingRow } from '@/data/api';
import { useGroup } from '@/data/hooks';
import { useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';
import { compactNumber, donutSlices, percentChange, previousMonthKey } from '@/lib/spendingChart';
import { isViewer } from '@/data/types';

enum Scope {
  Group = 'group',
  Mine = 'mine',
}

/** The window of months the columns show: six, or a year. */
const MONTH_WINDOWS = [6, 12] as const;

/** Leading categories the donut and its legend name; the rest are one slice. */
const TOP_CATEGORIES = 5;

const SCENE = require('../../../../assets/images/voice-scene.webp') as number;
/** The photograph is 849 × 1852. The header shows the far shore down to the terrace wall. */
const SCENE_W = 849;
const SCENE_H = 1852;
/** Where, in the photograph, the strip we want ends: the top of the terrace table. */
const SCENE_FOOT = 1300;
/** The photo's height below the status bar; the cards ride up over its foot. */
const HERO_BODY = 150;
const CARD_OVERLAP = 56;

export default function InsightsScreen() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const { t, locale } = useStrings();
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = id ?? '';
  const dark = theme.scheme === 'dark';
  useHeroStatusBar(dark ? 'light' : 'dark');

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

  const currencies = useMemo(
    () => spendingCurrencies(scoped, groupCurrency),
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

  const photoH = insets.top + HERO_BODY;
  // `cover` by hand: full width, the strip ending at the terrace wall sitting
  // on the bottom edge of the band.
  const scale = Math.max(windowWidth / SCENE_W, photoH / SCENE_FOOT);
  const ink = theme.color.text;
  const glass = dark ? 'rgba(20,20,34,0.72)' : 'rgba(255,255,255,0.82)';

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: clearance }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ height: photoH, overflow: 'hidden' }}>
          <Image
            source={SCENE}
            accessibilityIgnoresInvertColors
            accessibilityElementsHidden
            importantForAccessibility="no"
            fadeDuration={0}
            style={{
              position: 'absolute',
              width: SCENE_W * scale,
              height: SCENE_H * scale,
              left: (windowWidth - SCENE_W * scale) / 2,
              top: photoH - SCENE_FOOT * scale,
            }}
          />
          {dark ? (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: 0,
                bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.45)',
              }}
            />
          ) : null}
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(0,0,0,0)', theme.color.bg]}
            style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 56 }}
          />
          <View
            style={{
              paddingTop: insets.top + theme.spacing.sm,
              paddingHorizontal: theme.spacing.lg,
            }}
          >
            <Row style={{ alignItems: 'center' }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.common.back}
                onPress={() => router.back()}
                hitSlop={8}
                style={{ width: 40, height: 40, justifyContent: 'center' }}
              >
                <Ionicons name={directionalIcon('chevron-back')} size={iconSize.xl} color={ink} />
              </Pressable>
              <Text
                variant="heading"
                align="center"
                accessibilityRole="header"
                style={{ flex: 1, fontSize: 22, fontWeight: '800' }}
              >
                {t.spending}
              </Text>
              <View style={{ width: 40 }} />
            </Row>
            <Row
              style={{ alignItems: 'center', gap: theme.spacing.sm, marginTop: theme.spacing.lg }}
            >
              {[
                { value: Scope.Group, label: t.extras.theGroup },
                { value: Scope.Mine, label: t.extras.justMe },
              ].map((option) => {
                const selected = option.value === scope;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setScope(option.value)}
                    style={{
                      height: 38,
                      paddingHorizontal: theme.spacing.lg,
                      borderRadius: theme.radius.pill,
                      justifyContent: 'center',
                      backgroundColor: selected ? '#1F1B4D' : glass,
                    }}
                  >
                    <Text
                      variant="caption"
                      style={{
                        fontWeight: '600',
                        color: selected ? '#FFFFFF' : theme.color.textMuted,
                      }}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
              <View style={{ flex: 1 }} />
              {month ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t.spendPickMonth}: ${monthLabel(month, locale, true)}`}
                  onPress={() => setSheet('month')}
                  style={{
                    height: 38,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    paddingHorizontal: theme.spacing.md,
                    borderRadius: theme.radius.pill,
                    backgroundColor: glass,
                  }}
                >
                  <Ionicons name="calendar-outline" size={iconSize.base} color={ink} />
                  <Text variant="caption" style={{ fontWeight: '600' }}>
                    {monthLabel(month, locale, true)}
                  </Text>
                  <Ionicons name="chevron-down" size={iconSize.sm} color={ink} />
                </Pressable>
              ) : null}
            </Row>
          </View>
        </View>

        <View
          style={{
            marginTop: -CARD_OVERLAP,
            paddingHorizontal: theme.spacing.lg,
            gap: theme.spacing.xl,
          }}
        >
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

          <Text variant="micro" tone="muted" align="center">
            {t.misc.insightsLiveNote}
          </Text>
        </View>
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
  const [windowSize, setWindowSize] = useState<(typeof MONTH_WINDOWS)[number]>(6);
  const [windowOpen, setWindowOpen] = useState(false);
  const [allLegend, setAllLegend] = useState(false);
  const [allTop, setAllTop] = useState(false);

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

  const window = allMonths.slice(-windowSize);
  const bars = window.map((entry) => ({
    key: entry.month,
    label: monthLabel(entry.month, locale),
    value: toMajor(entry.value),
    description: `${monthLabel(entry.month, locale)}: ${money(entry.value)}`,
  }));
  const trend = allMonths.slice(-6).map((entry) => toMajor(entry.value));

  const legend = allLegend ? categories : categories.slice(0, TOP_CATEGORIES);
  const topList = allTop ? categories : categories.slice(0, TOP_CATEGORIES);
  const link = (label: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
    >
      <Text variant="caption" tone="brand" style={{ fontWeight: '600' }}>
        {label}
      </Text>
      <Ionicons
        name={directionalIcon('chevron-forward')}
        size={iconSize.sm}
        color={theme.color.brand}
      />
    </Pressable>
  );
  const heading = (title: string, trailing: React.ReactNode) => (
    <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
      <Text variant="heading" accessibilityRole="header" style={{ fontWeight: '800' }}>
        {title}
      </Text>
      {trailing}
    </Row>
  );

  return (
    <>
      <Card style={{ padding: 0, overflow: 'hidden', borderRadius: theme.radius.xl }}>
        <View style={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.sm }}>
          <Row style={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
                <Ionicons name="wallet-outline" size={iconSize.lg} color={theme.color.textMuted} />
                <Text variant="body" tone="muted">
                  {t.spendTotal}
                </Text>
              </Row>
              <Text
                accessibilityLabel={`${t.spendTotal}: ${money(total)}`}
                numberOfLines={1}
                adjustsFontSizeToFit
                style={{
                  fontSize: 32,
                  lineHeight: 40,
                  fontWeight: '800',
                  color: theme.color.text,
                  marginTop: theme.spacing.xs,
                }}
              >
                {totalParts.lead}
                <Text
                  style={{
                    fontSize: 32,
                    lineHeight: 40,
                    fontWeight: '800',
                    color: theme.color.textFaint,
                  }}
                >
                  {totalParts.fraction}
                  {totalParts.trail}
                </Text>
              </Text>
              {hasSeveralCurrencies ? (
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
              )}
            </View>
            {change !== null ? (
              <View style={{ alignItems: 'center', gap: 2 }}>
                <Row
                  style={{
                    alignItems: 'center',
                    gap: 2,
                    paddingHorizontal: theme.spacing.md,
                    paddingVertical: 4,
                    borderRadius: theme.radius.pill,
                    backgroundColor:
                      change >= 0 ? 'rgba(34,163,94,0.14)' : theme.color.negativeSoft,
                  }}
                >
                  <Ionicons
                    name={change >= 0 ? 'arrow-up' : 'arrow-down'}
                    size={iconSize.sm}
                    color={change >= 0 ? '#16A34A' : theme.color.negative}
                  />
                  <Text
                    variant="caption"
                    style={{
                      fontWeight: '700',
                      color: change >= 0 ? '#16A34A' : theme.color.negative,
                    }}
                  >
                    {`${Math.abs(change)}%`}
                  </Text>
                </Row>
                <Text variant="micro" tone="muted">
                  {t.spendVsLast}
                </Text>
              </View>
            ) : null}
          </Row>
        </View>
        {trend.length > 1 ? (
          <Sparkline values={trend} />
        ) : (
          <View style={{ height: theme.spacing.md }} />
        )}
      </Card>

      <View style={{ gap: theme.spacing.md }}>
        {heading(
          t.byCategory,
          categories.length > TOP_CATEGORIES
            ? link(allLegend ? t.spendShowLess : t.spendSeeAll, () => setAllLegend((v) => !v))
            : null,
        )}
        <Card style={{ borderRadius: theme.radius.xl }}>
          <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <Donut
              slices={slices}
              centre={`${symbol}${compactNumber(toMajor(total))}`}
              caption={t.spendDonutTotal}
            />
            <View style={{ flex: 1, gap: theme.spacing.md }}>
              {legend.map((entry, index) => (
                <Row
                  key={entry.key}
                  accessible
                  accessibilityLabel={`${entry.label}, ${money(entry.value)}, ${entry.percent}%`}
                  style={{ alignItems: 'center', gap: theme.spacing.sm }}
                >
                  <CategoryBadge
                    category={entry.category}
                    meta={entry.meta}
                    size={26}
                    accent={RANK_COLORS[index] ?? REST_COLOR}
                  />
                  <Text variant="micro" numberOfLines={1} style={{ flex: 1, fontWeight: '600' }}>
                    {entry.label}
                  </Text>
                  <Text variant="micro" numberOfLines={1} tabular style={{ fontWeight: '600' }}>
                    {money(entry.value)}
                  </Text>
                  <Text variant="micro" tone="muted" style={{ width: 28, textAlign: 'right' }}>
                    {`${entry.percent}%`}
                  </Text>
                </Row>
              ))}
            </View>
          </Row>
        </Card>
      </View>

      <View style={{ gap: theme.spacing.md }}>
        {heading(
          t.byMonth,
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
          </View>,
        )}
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
        <Card style={{ borderRadius: theme.radius.xl, gap: theme.spacing.md }}>
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
        </Card>
      </View>

      <View style={{ gap: theme.spacing.md }}>
        {heading(
          t.spendTopCategories,
          categories.length > TOP_CATEGORIES
            ? link(allTop ? t.spendShowLess : t.spendSeeAll, () => setAllTop((v) => !v))
            : null,
        )}
        <Card style={{ borderRadius: theme.radius.xl, gap: theme.spacing.md }}>
          {topList.map((entry, index) => (
            <Row
              key={entry.key}
              accessible
              accessibilityLabel={`${entry.label}, ${money(entry.value)}, ${entry.percent}%`}
              style={{ alignItems: 'center', gap: theme.spacing.md }}
            >
              <CategoryBadge
                category={entry.category}
                meta={entry.meta}
                size={34}
                accent={RANK_COLORS[index] ?? REST_COLOR}
              />
              <View style={{ flex: 1, gap: 4 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text variant="body" numberOfLines={1} style={{ fontWeight: '600', flex: 1 }}>
                    {entry.label}
                  </Text>
                  <Text variant="body" tabular style={{ fontWeight: '600' }}>
                    {money(entry.value)}
                  </Text>
                </Row>
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
              </View>
              <Text variant="caption" tone="muted" style={{ width: 36, textAlign: 'right' }}>
                {`${entry.percent}%`}
              </Text>
            </Row>
          ))}
        </Card>
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
