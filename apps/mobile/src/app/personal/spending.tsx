/**
 * Spending (A48): a month of your own money, taken apart.
 *
 * The Me tab already says income, expense, net. That is a true summary and a
 * poor answer, because it puts the rent and the restaurants in one number. This
 * screen splits the month instead — income, bills and subscriptions, everything
 * else, and what was left — so the one figure a person can actually act on
 * (what they *chose* to spend) stops hiding behind the one they cannot.
 *
 * Three decisions worth keeping in view:
 *
 * **"Left over" is not "saved".** The app cannot see a savings account. It
 * knows only that some money was not spent; whether any of it was put away is
 * not something this ledger witnessed. The row says what is true.
 *
 * **The bills switch is the whole point of the chart.** A month the rent lands
 * in looks catastrophic beside one it does not, and six columns drawn that way
 * teach nothing. Taking the bills out makes the six comparable, and the switch
 * is on the screen rather than a setting because both views are worth having.
 *
 * **Nothing is converted.** One currency is summed (ADR-003), the default one,
 * and if the ledger holds entries in others the screen says so in words rather
 * than quietly leaving them out of a total that looks complete.
 *
 * The chart is a row of plain views, like every other chart in the app — see
 * the note atop @waves/ui's Chart. This one draws two columns per month
 * (earned, spent) which that primitive does not do, so it is local; everything
 * else on the screen is the shared kit.
 *
 * All the arithmetic is in @waves/core (personal/spending), computed on the
 * device from the mirror like the rest of the section. Nothing here adds up
 * money.
 */

import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';

import {
  computePersonalSpending,
  format,
  money,
  personalSpendingCurrencies,
  personalSpendingTrend,
  recentMonths,
  spentInMonth,
  type PersonalMonthSplit,
} from '@waves/core';
import {
  Card,
  directionalIcon,
  EmptyState,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  Toggle,
  useTheme,
} from '@waves/ui';

import { todayIso, usePersonalLedger } from '@/data/personal';
import { useDefaultCurrency } from '@/lib/currency';
import { fill, useStrings } from '@/i18n';
import { PersonalGuard } from '@/components/PersonalGuard';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';

/** How many columns the chart draws. Six is two quarters: long enough for a
 *  quarterly bill to appear twice, short enough to read at phone width. */
const WINDOW = 6;

function SpendingScreenBody() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const dc = useDefaultCurrency();
  const { txns } = usePersonalLedger();

  // The window ends at the month the person is in and does not move. A chart
  // that slid under a finger every time a column was tapped would make the
  // columns harder to compare, which is the only thing a chart is for.
  const [thisMonth] = useState(() => todayIso().slice(0, 7));
  const months = useMemo(() => recentMonths(thisMonth, WINDOW), [thisMonth]);
  const [month, setMonth] = useState(thisMonth);
  const [includeBills, setIncludeBills] = useState(true);

  // No classifier yet: the recurring rules cannot say which of them are bills,
  // so `computePersonalSpending` is left on its default and the Bills row reads
  // zero. The day a rule carries a kind, one `isBillLike` passed here fills the
  // row in and nothing else on this screen changes.
  const trend = useMemo(() => personalSpendingTrend(txns, months, dc), [txns, months, dc]);
  const split = useMemo(() => computePersonalSpending(txns, month, dc), [txns, month, dc]);
  const others = useMemo(
    () => personalSpendingCurrencies(txns, dc).filter((code) => code !== dc),
    [txns, dc],
  );

  const index = months.indexOf(month);
  const fmt = (amount: bigint): string => format(money(amount, dc), { locale });

  return (
    <Screen>
      <Row
        style={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.md,
          alignItems: 'center',
        }}
      >
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="heading">{t.personal.spendingTitle}</Text>
        </View>
        {/* Balances the back button so the title sits centred. */}
        <View style={{ width: iconSize.lg + theme.spacing.md }} />
      </Row>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: clearance,
          gap: theme.spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text
          variant="caption"
          tone="muted"
          align="center"
          style={{ marginBottom: theme.spacing.xs }}
        >
          {t.personal.spendingSub}
        </Text>

        {txns.length === 0 ? (
          // A first run, not a chart of zeroes. Six empty columns and four rows
          // reading nought look like a screen that failed to load; they also ask
          // for work without saying what the work is for.
          <View style={{ paddingTop: theme.spacing.xxl }}>
            <EmptyState
              title={t.personal.spendingEmpty}
              body={t.personal.spendingEmptyBody}
              icon={<Ionicons name="stats-chart" size={iconSize.jumbo} color={theme.color.brand} />}
            />
          </View>
        ) : (
          <>
            <Card style={{ gap: theme.spacing.lg }}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Text variant="micro" tone="faint" style={{ letterSpacing: 0.8 }}>
                  {t.personal.last6Months.toUpperCase()}
                </Text>
                <Legend
                  earned={t.personal.earned}
                  spent={includeBills ? t.personal.spent : t.personal.everyday}
                />
              </Row>

              <EarnedSpentChart
                trend={trend}
                selected={month}
                includeBills={includeBills}
                onSelect={setMonth}
                labelFor={(key) => monthShort(key, locale)}
                accessibleAmount={fmt}
                earnedLabel={t.personal.earned}
                spentLabel={includeBills ? t.personal.spent : t.personal.everyday}
              />

              <View
                style={{
                  height: 1,
                  backgroundColor: theme.color.border,
                  marginHorizontal: -theme.spacing.xl,
                }}
              />

              <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Text variant="body">{t.personal.includeBills}</Text>
                  <Text variant="micro" tone="muted">
                    {t.personal.includeBillsHint}
                  </Text>
                </View>
                <Toggle
                  value={includeBills}
                  onValueChange={setIncludeBills}
                  accessibilityLabel={t.personal.includeBills}
                />
              </Row>
            </Card>

            <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
              <StepButton
                icon={directionalIcon('chevron-back')}
                label={t.personal.prevMonth}
                disabled={index <= 0}
                onPress={() => setMonth(months[index - 1] ?? month)}
              />
              <Text variant="subheading" align="center" style={{ flex: 1 }} numberOfLines={1}>
                {monthLabel(month, locale)}
              </Text>
              <StepButton
                icon={directionalIcon('chevron-forward')}
                label={t.personal.nextMonth}
                disabled={index < 0 || index >= months.length - 1}
                onPress={() => setMonth(months[index + 1] ?? month)}
              />
            </Row>

            <Card style={{ gap: theme.spacing.md }}>
              <SplitRow
                label={t.personal.income}
                amount={fmt(split.income)}
                tint={theme.tint.mint.ink}
              />
              <SplitRow
                label={t.personal.billsAndSubs}
                amount={fmt(split.bills)}
                tint={theme.tint.sky.ink}
                note={split.bills === 0n ? t.personal.noBillsMarked : undefined}
              />
              <SplitRow
                label={t.personal.everyday}
                amount={fmt(split.spending)}
                tint={theme.tint.coral.ink}
              />

              <View style={{ height: 1, backgroundColor: theme.color.border }} />

              <View style={{ gap: theme.spacing.xs }}>
                <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
                  <Text variant="subheading" style={{ flex: 1 }}>
                    {t.personal.leftOver}
                  </Text>
                  <Text
                    variant="heading"
                    tabular
                    numberOfLines={1}
                    style={{
                      color: split.leftOver < 0n ? theme.color.negative : theme.color.text,
                    }}
                  >
                    {split.leftOver < 0n ? '−' : ''}
                    {fmt(split.leftOver < 0n ? -split.leftOver : split.leftOver)}
                  </Text>
                </Row>
                {/* Said every time, not only when it might mislead: the row is
                    a number about somebody's life and the limit of what it
                    knows belongs beside it. */}
                <Text variant="micro" tone="muted">
                  {t.personal.leftOverHint}
                </Text>
              </View>
            </Card>

            {others.length > 0 ? (
              <Text variant="micro" tone="muted" align="center">
                {fill(t.personal.onlyCurrency, { currency: dc, others: others.join(', ') })}
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

// ──────────────────────────────────────────────────────────────── chart ──

/**
 * Six months, two columns each: what came in, and what went out.
 *
 * Both columns scale against the largest figure anywhere in the window, not
 * against their own month — the comparison the chart exists to make is between
 * months, and per-month scaling would draw every month the same height and say
 * nothing. A column that rounds to nothing still gets a sliver, because "almost
 * none" and "none" are different answers (the same rule @waves/ui's BarList
 * follows).
 *
 * Tapping a column picks the month the card below reads. The unselected months
 * are dimmed rather than recoloured: a second colour would look like a third
 * series.
 */
function EarnedSpentChart({
  trend,
  selected,
  includeBills,
  onSelect,
  labelFor,
  accessibleAmount,
  earnedLabel,
  spentLabel,
}: {
  trend: readonly PersonalMonthSplit[];
  selected: string;
  includeBills: boolean;
  onSelect: (month: string) => void;
  labelFor: (month: string) => string;
  accessibleAmount: (amount: bigint) => string;
  earnedLabel: string;
  spentLabel: string;
}) {
  const theme = useTheme();
  const height = 96;

  const pairs = trend.map((split) => ({
    month: split.month,
    earned: split.income,
    spent: spentInMonth(split, includeBills),
  }));
  const largest = pairs.reduce(
    (max, pair) => (pair.earned > max ? pair.earned : pair.spent > max ? pair.spent : max),
    0n,
  );
  // Integer percent off bigint; no float ever touches the money.
  const barHeight = (value: bigint): number =>
    largest > 0n
      ? Math.max((Number((value * 100n) / largest) / 100) * height, value > 0n ? 3 : 0)
      : 0;

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Row style={{ alignItems: 'flex-end', gap: theme.spacing.sm, height }}>
        {pairs.map((pair) => {
          const isSelected = pair.month === selected;
          return (
            <Pressable
              key={pair.month}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${labelFor(pair.month)}. ${earnedLabel} ${accessibleAmount(
                pair.earned,
              )}. ${spentLabel} ${accessibleAmount(pair.spent)}`}
              onPress={() => onSelect(pair.month)}
              style={({ pressed }) => ({
                flex: 1,
                height,
                justifyContent: 'flex-end',
                opacity: pressed ? 0.6 : isSelected ? 1 : 0.45,
              })}
            >
              <Row style={{ alignItems: 'flex-end', gap: 3, justifyContent: 'center' }}>
                <View
                  style={{
                    flex: 1,
                    maxWidth: 16,
                    height: barHeight(pair.earned),
                    borderRadius: theme.radius.sm,
                    backgroundColor: theme.tint.mint.ink,
                  }}
                />
                <View
                  style={{
                    flex: 1,
                    maxWidth: 16,
                    height: barHeight(pair.spent),
                    borderRadius: theme.radius.sm,
                    backgroundColor: theme.tint.coral.ink,
                  }}
                />
              </Row>
            </Pressable>
          );
        })}
      </Row>
      <Row style={{ gap: theme.spacing.sm }}>
        {pairs.map((pair) => (
          <Text
            key={pair.month}
            variant="micro"
            align="center"
            tone={pair.month === selected ? 'default' : 'faint'}
            style={{ flex: 1 }}
            numberOfLines={1}
          >
            {labelFor(pair.month)}
          </Text>
        ))}
      </Row>
    </View>
  );
}

/** Which colour means what, in two dots. Small enough to sit in the chart's
 *  header, where the question is asked. */
function Legend({ earned, spent }: { earned: string; spent: string }) {
  const theme = useTheme();
  const dot = (color: string, label: string) => (
    <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text variant="micro" tone="muted">
        {label}
      </Text>
    </Row>
  );
  return (
    <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
      {dot(theme.tint.mint.ink, earned)}
      {dot(theme.tint.coral.ink, spent)}
    </Row>
  );
}

// ───────────────────────────────────────────────────────────────── rows ──

/**
 * One line of the split: a coloured dot tying the row to its column in the
 * chart, a name, and the money.
 *
 * Not tappable, and the chevron is left off rather than drawn dead: the entries
 * list has no filter to push into, and an affordance that does nothing is worse
 * than none at all. When that list learns to filter, this row is where the tap
 * goes.
 */
function SplitRow({
  label,
  amount,
  tint,
  note,
}: {
  label: string;
  amount: string;
  tint: string;
  note?: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tint }} />
        <Text variant="body" style={{ flex: 1 }} numberOfLines={1}>
          {label}
        </Text>
        <Text variant="subheading" tabular numberOfLines={1}>
          {amount}
        </Text>
      </Row>
      {note ? (
        <Text variant="micro" tone="faint" style={{ paddingLeft: theme.spacing.lg }}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A month step. Disabled at the ends of the window rather than hidden, so the
 * month name never jumps sideways as it reaches the edge — and disabled in the
 * way a screen reader can hear, which is why this is a Pressable and not the
 * shared IconButton (that one takes no disabled state; a missing `onPress`
 * would still be announced as a live button).
 */
function StepButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons
        name={icon}
        size={iconSize.lg}
        color={disabled ? theme.color.textFaint : theme.color.text}
      />
    </Pressable>
  );
}

// ───────────────────────────────────────────────────────────── calendar ──

// The month in full (September 2026) and short (Sep), built from the first of
// the month with an explicit local time so no timezone can shift it a day back
// into the month before. Falls back to the raw key if the locale is unknown.
function monthLabel(month: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
      new Date(`${month}-01T00:00:00`),
    );
  } catch {
    return month;
  }
}

function monthShort(month: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { month: 'short' }).format(
      new Date(`${month}-01T00:00:00`),
    );
  } catch {
    return month;
  }
}

/**
 * Behind the section shield, like every other room under `personal/`: one
 * unlock covers the Me tab and all of them, so arriving here never asks again.
 */
export default function PersonalSpendingScreen() {
  return (
    <PersonalGuard>
      <SpendingScreenBody />
    </PersonalGuard>
  );
}
