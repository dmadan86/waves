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

import { useMemo, useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import {
  computePersonalSpending,
  format,
  minorUnitScale,
  money,
  personalSpendingCurrencies,
  personalSpendingTrend,
  recentMonths,
  spentInMonth,
  type PersonalMonthSplit,
} from '@waves/core';
import {
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
import { SPEC_ACCENT, SPEC_INK, SPEC_MUTED } from '@/lib/specPalette';

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
  const dcScale = minorUnitScale(dc);
  const dark = theme.scheme === 'dark';
  const ink = dark ? theme.color.text : SPEC_INK;
  const muted = dark ? theme.color.textMuted : SPEC_MUTED;
  const accent = dark ? theme.color.brand : SPEC_ACCENT;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance,
          gap: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* The header: back, the title big, the line on what the screen is,
            and the picture beside them. */}
        <View style={{ paddingTop: theme.spacing.sm, minHeight: 104 }}>
          <SpendingArt />
          <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
            <IconButton label={t.common.back} onPress={() => router.back()}>
              <Ionicons name={directionalIcon('chevron-back')} size={iconSize.lg} color={ink} />
            </IconButton>
            <Text style={{ fontSize: 28, lineHeight: 34, fontWeight: '800', color: ink }}>
              {t.personal.spendingTitle}
            </Text>
          </Row>
          <Text
            style={{
              marginTop: 2,
              marginStart: 48,
              maxWidth: '56%',
              fontSize: 13,
              lineHeight: 18,
              color: muted,
            }}
          >
            {t.personal.spendingSub}
          </Text>
        </View>

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
            <SoftCard style={{ gap: theme.spacing.sm }}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: ink }}>
                  {t.personal.last6Months}
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
                scale={dcScale}
                locale={locale}
              />
            </SoftCard>

            {/* The switch that makes the six columns comparable, as a card of its
                own: a month the rent lands in looks nothing like one it does not. */}
            <SoftCard
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
                paddingVertical: theme.spacing.md,
              }}
            >
              <IconDisc icon="document-text-outline" color={accent} soft={theme.color.brandSoft} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: ink }}>
                  {t.personal.includeBills}
                </Text>
                <Text style={{ fontSize: 12, lineHeight: 16, color: muted }}>
                  {t.personal.includeBillsHint}
                </Text>
              </View>
              <Toggle
                value={includeBills}
                onValueChange={setIncludeBills}
                accessibilityLabel={t.personal.includeBills}
              />
            </SoftCard>

            <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
              <StepButton
                icon={directionalIcon('chevron-back')}
                label={t.personal.prevMonth}
                disabled={index <= 0}
                onPress={() => setMonth(months[index - 1] ?? month)}
              />
              <Text
                numberOfLines={1}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  fontSize: 16,
                  fontWeight: '700',
                  color: ink,
                }}
              >
                {monthLabel(month, locale)}
              </Text>
              <StepButton
                icon={directionalIcon('chevron-forward')}
                label={t.personal.nextMonth}
                disabled={index < 0 || index >= months.length - 1}
                onPress={() => setMonth(months[index + 1] ?? month)}
              />
            </Row>

            <SoftCard style={{ gap: theme.spacing.md }}>
              <SplitRow
                icon="wallet"
                tint={theme.tint.lilac}
                label={t.personal.income}
                sub={t.personal.incomeSub}
                amount={fmt(split.income)}
              />
              <SplitRow
                icon="document-text"
                tint={theme.tint.sky}
                label={t.personal.billsAndSubs}
                sub={split.bills === 0n ? t.personal.noBillsMarked : t.personal.billsSub}
                amount={fmt(split.bills)}
              />
              <SplitRow
                icon="cart"
                tint={theme.tint.coral}
                label={t.personal.everyday}
                sub={t.personal.everydaySub}
                amount={fmt(split.spending)}
              />

              <View style={{ height: 1, backgroundColor: theme.color.border }} />

              {/* What was left, on a soft green panel — the one figure here that
                  is good news when it is big. Not "saved": the app cannot see a
                  savings account, and the line under it says so every time. */}
              <Row
                style={{
                  alignItems: 'center',
                  gap: theme.spacing.md,
                  paddingHorizontal: theme.spacing.md,
                  paddingVertical: theme.spacing.sm,
                  marginHorizontal: -theme.spacing.xs,
                  borderRadius: 16,
                  backgroundColor: dark ? 'rgba(40, 180, 110, 0.10)' : '#EEF8F1',
                }}
              >
                <IconDisc
                  icon="pie-chart"
                  color={LEFT_OVER_GREEN}
                  soft={dark ? 'rgba(40,180,110,0.18)' : '#DDF1E4'}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: ink }}>
                    {t.personal.leftOver}
                  </Text>
                  <Text style={{ fontSize: 11, lineHeight: 15, color: muted }}>
                    {t.personal.leftOverHint}
                  </Text>
                </View>
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                  style={{
                    fontSize: 16,
                    fontWeight: '800',
                    fontVariant: ['tabular-nums'],
                    color: split.leftOver < 0n ? theme.color.negative : LEFT_OVER_GREEN,
                  }}
                >
                  {split.leftOver < 0n ? '−' : ''}
                  {fmt(split.leftOver < 0n ? -split.leftOver : split.leftOver)}
                </Text>
              </Row>
            </SoftCard>

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

/** The chart's two series: violet for what came in, coral for what went out. */
const EARNED = ['#8C83FF', '#6C5CE7'] as const;
const SPENT = ['#F7A1A1', '#EB6B6B'] as const;
const LEFT_OVER_GREEN = '#1E9E5A';

/**
 * Six months, two columns each: what came in, and what went out — against a
 * scale with its figures on the left and dashed lines across.
 *
 * Both columns scale against the same rounded-up top of the scale, not their
 * own month — the comparison the chart exists to make is between months. A
 * column that rounds to nothing still gets a sliver, because "almost none" and
 * "none" are different answers.
 *
 * Tapping a month picks the one the card below reads; its name goes bold and
 * what it earned is tagged over its column.
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
  scale,
  locale,
}: {
  trend: readonly PersonalMonthSplit[];
  selected: string;
  includeBills: boolean;
  onSelect: (month: string) => void;
  labelFor: (month: string) => string;
  accessibleAmount: (amount: bigint) => string;
  earnedLabel: string;
  spentLabel: string;
  /** Minor units per major unit of the currency, for the axis figures. */
  scale: bigint;
  locale: string;
}) {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  const ink = dark ? theme.color.text : SPEC_INK;
  const muted = dark ? theme.color.textMuted : SPEC_MUTED;
  const height = CHART_HEIGHT;

  const pairs = trend.map((split) => ({
    month: split.month,
    earned: split.income,
    spent: spentInMonth(split, includeBills),
  }));
  const largest = pairs.reduce(
    (max, pair) => (pair.earned > max ? pair.earned : pair.spent > max ? pair.spent : max),
    0n,
  );
  const top = niceTop(largest, scale);
  // Integer percent off bigint; no float ever touches the money.
  const barHeight = (value: bigint): number =>
    top > 0n ? Math.max((Number((value * 1000n) / top) / 1000) * height, value > 0n ? 3 : 0) : 0;
  const ticks = [4, 3, 2, 1, 0].map((step) => (top * BigInt(step)) / 4n);
  const compact = (minor: bigint): string => {
    try {
      return new Intl.NumberFormat(locale, {
        notation: 'compact',
        maximumFractionDigits: 1,
      }).format(Number(minor / (scale > 0n ? scale : 1n)));
    } catch {
      return String(minor / (scale > 0n ? scale : 1n));
    }
  };
  const chosen = pairs.find((pair) => pair.month === selected);

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Row style={{ gap: theme.spacing.sm }}>
        {/* The scale's figures, top to bottom. */}
        <View style={{ height, justifyContent: 'space-between', width: AXIS_WIDTH }}>
          {ticks.map((tick, i) => (
            <Text
              key={i}
              numberOfLines={1}
              style={{ fontSize: 10, lineHeight: 14, color: muted, textAlign: 'right' }}
            >
              {compact(tick)}
            </Text>
          ))}
        </View>
        <View style={{ flex: 1, height }}>
          {/* Dashed lines across at each figure. */}
          {ticks.map((_, i) => (
            <View
              key={i}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: (height * i) / 4 + 7,
                borderTopWidth: 1,
                borderStyle: i === 4 ? 'solid' : 'dashed',
                borderColor: theme.color.border,
              }}
            />
          ))}
          <Row style={{ flex: 1, alignItems: 'flex-end', paddingBottom: 0, marginTop: 7 }}>
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
                    height: height - 7,
                    justifyContent: 'flex-end',
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Row style={{ alignItems: 'flex-end', gap: 4, justifyContent: 'center' }}>
                    <Bar colors={EARNED} height={barHeight(pair.earned)} ring={isSelected} />
                    <Bar colors={SPENT} height={barHeight(pair.spent)} />
                  </Row>
                </Pressable>
              );
            })}
          </Row>
          {/* The chosen month's earnings, tagged over its column. */}
          {chosen && chosen.earned > 0n ? (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: Math.max(0, height - barHeight(chosen.earned) - 42),
                ...(pairs.indexOf(chosen) >= pairs.length / 2
                  ? {
                      right: `${((pairs.length - 1 - pairs.indexOf(chosen)) * 100) / pairs.length}%`,
                    }
                  : { left: `${(pairs.indexOf(chosen) * 100) / pairs.length}%` }),
                paddingHorizontal: 8,
                paddingVertical: 4,
                borderRadius: 10,
                backgroundColor: theme.color.surface,
                shadowColor: '#2A1E6B',
                shadowOpacity: 0.1,
                shadowRadius: 10,
                shadowOffset: { width: 0, height: 4 },
                elevation: 3,
              }}
            >
              <Text style={{ fontSize: 10, color: muted }}>{earnedLabel}</Text>
              <Text style={{ fontSize: 12, fontWeight: '700', color: ink }}>
                {accessibleAmount(chosen.earned)}
              </Text>
            </View>
          ) : null}
        </View>
      </Row>
      <Row style={{ gap: theme.spacing.sm }}>
        <View style={{ width: AXIS_WIDTH }} />
        <Row style={{ flex: 1 }}>
          {pairs.map((pair) => {
            const isSelected = pair.month === selected;
            return (
              <Text
                key={pair.month}
                numberOfLines={1}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  fontSize: 12,
                  fontWeight: isSelected ? '800' : '400',
                  color: isSelected ? (dark ? theme.color.brand : SPEC_ACCENT) : muted,
                }}
              >
                {labelFor(pair.month)}
              </Text>
            );
          })}
        </Row>
      </Row>
    </View>
  );
}

/** One column: a rounded bar in its series' gradient. The chosen month's
 *  earned bar wears a small white bead at its top. */
function Bar({
  colors,
  height,
  ring = false,
}: {
  colors: readonly [string, string];
  height: number;
  ring?: boolean;
}) {
  if (height <= 0) return <View style={{ width: BAR_WIDTH }} />;
  return (
    <View style={{ width: BAR_WIDTH, height }}>
      <LinearGradient
        colors={colors}
        style={{ width: BAR_WIDTH, height, borderRadius: BAR_WIDTH / 2 }}
      />
      {ring ? (
        <View
          style={{
            position: 'absolute',
            top: 3,
            alignSelf: 'center',
            width: BAR_WIDTH - 6,
            height: BAR_WIDTH - 6,
            borderRadius: BAR_WIDTH,
            borderWidth: 2,
            borderColor: '#FFFFFF',
          }}
        />
      ) : null}
    </View>
  );
}

/** The top of the scale: the largest figure rounded up to a step that divides
 *  into four round figures (50K steps under 200K, and so on). */
function niceTop(largest: bigint, scale: bigint): bigint {
  const unit = scale > 0n ? scale : 1n;
  const major = largest / unit + (largest % unit > 0n ? 1n : 0n);
  if (major <= 0n) return 4n * unit;
  const raw = Number(major) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  return BigInt(Math.ceil(step * 4)) * unit;
}

/** Which colour means what, in two dots. */
function Legend({ earned, spent }: { earned: string; spent: string }) {
  const theme = useTheme();
  const muted = theme.scheme === 'dark' ? theme.color.textMuted : SPEC_INK;
  const dot = (color: string, label: string) => (
    <Row style={{ alignItems: 'center', gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ fontSize: 12, color: muted }}>{label}</Text>
    </Row>
  );
  return (
    <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
      {dot(EARNED[1], earned)}
      {dot(SPENT[1], spent)}
    </Row>
  );
}

const CHART_HEIGHT = 128;
const AXIS_WIDTH = 30;
const BAR_WIDTH = 9;

// ───────────────────────────────────────────────────────────────── rows ──

/** A white card with the redesign's soft corners and lift. */
function SoftCard({ children, style }: { children: ReactNode; style?: object }) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.color.surface,
          borderRadius: 20,
          padding: theme.spacing.md,
          shadowColor: '#2A1E6B',
          shadowOpacity: 0.06,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 4 },
          elevation: 2,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** A glyph on its own soft disc. */
function IconDisc({
  icon,
  color,
  soft,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  soft: string;
}) {
  return (
    <View
      style={{
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: soft,
      }}
    >
      <Ionicons name={icon} size={18} color={color} />
    </View>
  );
}

/**
 * One line of the split: its glyph on a tinted disc, the name over a line on
 * what it is, and the money.
 *
 * Not tappable, and the chevron is left off rather than drawn dead: the entries
 * list has no filter to push into, and an affordance that does nothing is worse
 * than none at all.
 */
function SplitRow({
  icon,
  tint,
  label,
  sub,
  amount,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tint: { bg: string; ink: string };
  label: string;
  sub: string;
  amount: string;
}) {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  return (
    <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
      <IconDisc icon={icon} color={tint.ink} soft={tint.bg} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{ fontSize: 14, fontWeight: '700', color: dark ? theme.color.text : SPEC_INK }}
        >
          {label}
        </Text>
        <Text
          numberOfLines={1}
          style={{ fontSize: 12, color: dark ? theme.color.textMuted : SPEC_MUTED }}
        >
          {sub}
        </Text>
      </View>
      <Text
        numberOfLines={1}
        style={{
          fontSize: 15,
          fontWeight: '800',
          fontVariant: ['tabular-nums'],
          color: dark ? theme.color.text : SPEC_INK,
        }}
      >
        {amount}
      </Text>
    </Row>
  );
}

/**
 * A month step: a soft round button. Disabled at the ends of the window rather
 * than hidden, so the month name never jumps sideways as it reaches the edge —
 * and disabled in the way a screen reader can hear.
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
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.scheme === 'dark' ? theme.color.surfaceMuted : '#ECEBF6',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons
        name={icon}
        size={18}
        color={
          disabled ? theme.color.textFaint : theme.scheme === 'dark' ? theme.color.text : SPEC_INK
        }
      />
    </Pressable>
  );
}

/** The header's picture, in the top-right corner behind the title. A stand-in
 *  until the final artwork (a wallet, coins and a plant). */
function SpendingArt() {
  const theme = useTheme();
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        position: 'absolute',
        top: theme.spacing.xs,
        right: 0,
        width: 96,
        height: 96,
        borderRadius: 48,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.scheme === 'dark' ? 'rgba(255,255,255,0.05)' : '#ECEAFB',
      }}
    >
      <Ionicons
        name="wallet"
        size={44}
        color={theme.scheme === 'dark' ? theme.color.brand : '#7B6CF0'}
      />
    </View>
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
