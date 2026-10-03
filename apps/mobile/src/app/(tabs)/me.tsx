/**
 * The "Me" tab — the private personal-finance ledger (A48).
 *
 * A person's own money, nothing shared. It wears Home's clothes: the time of
 * day's scene runs up under the status bar, carrying just the section's name
 * and its face; one white card rides up over the scene's foot — on glass,
 * blended into it exactly like Home's balance card — carrying this month's
 * spend big with how it compares to last month, a short bar history, the
 * month picker, and the three figures beneath it (income, spent, what is
 * left). Below, on the plain page, the month reads top-down the way a person
 * scans it: the budget, what is still due, the top categories, the latest
 * spends, and the money tools (recurring bills and loans).
 *
 * Everything is local-first from the mirror and every figure is computed on
 * the device.
 *
 * Before any of that exists — no entry, no rule, no loan, no budget — the tab
 * is a first run instead (`PersonalFirstRun`), because a dashboard of zeroes
 * asks for work without ever saying what the work is for.
 *
 * Opening the tab also posts any auto-recurring entries that have come due since
 * it was last open (idempotent — see `postDueRecurring`).
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurTargetView } from 'expo-blur';
import { Animated, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import {
  cashflowTrend,
  categoryBreakdown,
  dueInMonth,
  format,
  money,
  monthOutlook,
  personalBudgetProgress,
  recentMonths,
  resolveCategory,
  spendDelta,
  worstOverBudget,
  type PersonalTxn,
} from '@waves/core';
import {
  Button,
  Card,
  directionalIcon,
  Divider,
  EmptyState,
  Gradient,
  iconSize,
  Row,
  Screen,
  Text,
  useTabBarClearance,
  useTheme,
  type TintName,
} from '@waves/ui';

import { CategoryBadge } from '@/components/Category';
import { GlassSurface } from '@/components/home/GlassSurface';
import { BALANCE_MASK } from '@/components/home/HomeBalanceCard';
import { HeroAvatar, HeroIconButton } from '@/components/home/HeroControls';
import { PersonalHeroBackground } from '@/components/home/PersonalHeroBackground';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { PersonalLocked } from '@/components/PersonalGuard';
import { PersonalIntro } from '@/components/PersonalIntro';
import { personalIntroSeen, rememberPersonalIntroSeen } from '@/lib/onboardingSeen';
import { useAvatarUrl } from '@/components/ProfileAvatar';
import { useSourceLabel } from '@/components/IncomeSource';
import { useHeroStatusBar } from '@/components/ScreenHero';
import { SignInWall } from '@/components/SignInWall';
import {
  postDueRecurring,
  todayIso,
  usePersonalLedger,
  useUpsertPersonalRecord,
} from '@/data/personal';
import { useDefaultCurrency } from '@/lib/currency';
import { dateTimeFormat } from '@/lib/dateTimeFormat';
import { useAuth, useViewerId } from '@/lib/auth';
import { usePersonalGate } from '@/lib/lock';
import { router } from '@/lib/navigation';
import { useHeroScene } from '@/lib/heroScenePreference';
import { HERO_THEMES } from '@/lib/scene';
import { useSync } from '@/sync';
import { fill, plural, useStrings } from '@/i18n';

// The first run's saturated wash, deep enough to hold white ink on every corner.
const SAVED_WASH = ['#1E5A8C', '#0C2E4A'] as const;

// One faint watermark glyph, bled off the hero's corner.
const HERO_GLYPH = 'wallet-outline' as const;

/** The AsyncStorage key remembering whether the dashboard's figures are
 *  hidden behind the eye — its own key, so it is independent of Home's. */
const AMOUNTS_HIDDEN_KEY = 'personal:amountsHidden';

/**
 * The eye toggle's state, remembered across opens — the same shape as Home's
 * `useBalanceHidden`, kept local because this ledger's figures are a separate
 * concern from the shared dashboard's balance. Reads once on mount so a
 * hidden month stays hidden after a relaunch, and writes on every toggle.
 * Defaults to shown.
 */
function usePersonalAmountsHidden(): { hidden: boolean; toggle: () => void } {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(AMOUNTS_HIDDEN_KEY)
      .then((value) => {
        if (alive && value === '1') setHidden(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const toggle = useCallback(() => {
    setHidden((was) => {
      const next = !was;
      void AsyncStorage.setItem(AMOUNTS_HIDDEN_KEY, next ? '1' : '0').catch(() => {});
      return next;
    });
  }, []);
  return { hidden, toggle };
}

/**
 * The account wall stands outside the ledger, not inside it: a guest session
 * cannot be signed back into, so a year of private spending kept under one is a
 * promise the app cannot keep (`components/SignInWall`). Outside, because
 * everything below reads the mirror and raises the biometric prompt on mount,
 * and neither should happen on the way to turning somebody away.
 */
export default function MeScreen() {
  const { isGuest } = useAuth();
  if (isGuest) return <SignInWall area="personal" />;
  return <MeLedger />;
}

function MeLedger() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const dc = useDefaultCurrency();
  const sourceLabel = useSourceLabel();
  const { hydrated } = useSync();
  const { profile } = useAuth();
  const avatarUrl = useAvatarUrl(profile?.avatar_url);
  const ledger = usePersonalLedger();
  const upsert = useUpsertPersonalRecord();
  // The eye on the summary card: masks every figure on it (and the three
  // tiles beneath it), the same privacy the dashboard's own eye gives Home.
  const { hidden: amountsHidden, toggle: toggleAmountsHidden } = usePersonalAmountsHidden();

  // The Me tab is the home of the private personal ledger — ask for biometrics
  // on entry and keep the screen a shield until it succeeds (below), so the
  // figures are never on show behind the prompt. One unlock covers the whole
  // section: the rooms under `personal/` mount the same gate and read the same
  // state, so walking into "add income" and back never asks again. Only time
  // spent away — out of the section, or with the app in the background — past
  // the "Ask again after" window brings it back.
  const gate = usePersonalGate(t.lock.personalPrompt);

  // Read the clock once, off render (the React Compiler forbids it inline).
  const [today] = useState(() => todayIso());
  const currentMonth = today.slice(0, 7);

  // Which month the hero and the sections are showing. 0 is the current month;
  // each step back subtracts a month. You cannot step past the current month,
  // nor back before the first month you have any entry in — wandering into
  // unbounded empty past months is not browsing a record. The ledger comes
  // newest-first, so the last txn's month is the earliest represented.
  const [monthsBack, setMonthsBack] = useState(0);
  const [monthMenuOpen, setMonthMenuOpen] = useState(false);
  const earliestMonth =
    ledger.txns.length > 0 ? ledger.txns[ledger.txns.length - 1]!.date.slice(0, 7) : currentMonth;
  const maxBack = Math.max(0, monthsBetween(earliestMonth, currentMonth));
  const month = monthsBack === 0 ? currentMonth : shiftMonth(currentMonth, -monthsBack);

  // The hero wears the scene for the time of day, or the one picked on the
  // Background screen.
  const scene = useHeroScene();
  // How far the page has scrolled, for the status bar's strip (below).
  const scrollY = useState(() => new Animated.Value(0))[0];
  const [gearOpen, setGearOpen] = useState(false);

  // The hero's geometry, measured: the scene runs from the top of the screen
  // down to the lower part of the month tiles, its shade ending where they
  // begin.
  const sceneRef = useRef<View>(null);
  const [heroHeight, setHeroHeight] = useState(insets.top + 120);
  const [tilesHeight, setTilesHeight] = useState(260);
  const tilesTop = heroHeight - HERO_OVERLAP;
  const sceneHeight = tilesTop + tilesHeight * 0.72;

  // Post due auto-recurring entries once the mirror has hydrated from disk and
  // there are recurring rules to act on. Gating on `hydrated` (not the raw mount)
  // means we never latch against a still-loading, empty ledger; gating on
  // local hydration — not a network round-trip — keeps it working offline, which
  // is the whole point of the local-first ledger. `posted` is set only after the
  // catch-up resolves and cleared on failure, so a transient write error can
  // retry on a later run rather than being swallowed for the session. Even a
  // double-fire is harmless: occurrence ids are deterministic
  // (recurringOccurrenceId), so a repeat upserts the same rows, never a dupe.
  // Always keyed on `today`, never the browsed month.
  const posted = useRef(false);
  const ready = hydrated && ledger.recurrings.length > 0;
  useEffect(() => {
    if (posted.current || !ready) return;
    posted.current = true;
    postDueRecurring(ledger, today, (input) => upsert.mutateAsync(input)).catch(() => {
      posted.current = false;
    });
    // Keyed on readiness only; `ledger`/`today`/`upsert` are read at fire time
    // and the ref makes it one-shot per successful run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // What actually moved this month. The recurring rules' still-expected money
  // stays out of these figures — a total that quietly included money nobody has
  // received would be the one lie a ledger cannot tell — and is listed below as
  // what the month is still waiting for.
  const summary = monthOutlook(ledger.txns, ledger.recurrings, month, dc, today);
  const due = dueInMonth(ledger.txns, ledger.recurrings, month, dc, today);
  const fmt = (amount: bigint): string => format(money(amount, dc), { locale });
  const catLabel = labelForCategory(t);

  // Spend against the month before, as a percentage — null when there is no
  // earlier month to hold it against.
  const delta = spendDelta(ledger.txns, month, dc);
  const change =
    delta && delta.prevExpense > 0n ? Number((delta.delta * 1000n) / delta.prevExpense) / 10 : null;

  // The last few months' spend, ending at the browsed month — the faint bars
  // behind the headline figure. Short on history (a fresh ledger), it is just
  // shorter; the chart never invents months that never happened.
  const spendHistory = cashflowTrend(
    ledger.txns,
    recentMonths(month, SPEND_HISTORY_MONTHS),
    dc,
  ).map((entry) => entry.expense);

  // The overall monthly cap, when one is set, and how far into it the month is.
  const overallBudget = ledger.budgets.find(
    (budget) => budget.category === null && budget.currency === dc,
  );
  const budgetProgress = overallBudget
    ? personalBudgetProgress(overallBudget, ledger.txns, month)
    : null;
  // With no overall cap, the category budgets still have something to say: how
  // many there are, and the one that has run furthest past its cap.
  const categoryBudgetCount = ledger.budgets.filter((budget) => budget.category !== null).length;
  const worstOver = worstOverBudget(ledger.budgets, ledger.txns, month, dc);
  const worstOverLine = worstOver
    ? fill(t.personal.dash.overBy, {
        name: worstOver.budget.category
          ? (catLabel(worstOver.budget.category) ?? t.categories.other)
          : t.personal.overall,
        amount: fmt(worstOver.over),
      })
    : null;

  // Where the month's money went — the four biggest categories, each with its
  // share. Personal txns carry no category-meta snapshot, so unknown/custom-tag
  // ids all resolve to the same built-in "Other"; fold them into one bucket
  // (summing spend and share) BEFORE sorting and slicing, or several look-alike
  // "Other" columns would crowd real categories out.
  const buckets = new Map<string, { spent: bigint; share: number }>();
  for (const row of categoryBreakdown(ledger.txns, month, dc)) {
    const key = resolveCategory(row.category, null).builtinId ?? 'other';
    const prev = buckets.get(key);
    buckets.set(key, {
      spent: (prev?.spent ?? 0n) + row.spent,
      share: (prev?.share ?? 0) + row.share,
    });
  }
  const categoryBuckets = [...buckets]
    .sort((a, b) =>
      b[1].spent === a[1].spent ? (a[0] < b[0] ? -1 : 1) : b[1].spent > a[1].spent ? 1 : -1,
    )
    .map(([key, agg]) => ({ key, ...agg }));
  // The donut and its list show the five biggest categories; whatever is left
  // folds into one "Others" row and segment, so the two always add up to the
  // whole month rather than quietly dropping the tail.
  const topCategories = categoryBuckets.slice(0, TOP_CATEGORY_COUNT);
  const otherCategoryTail = categoryBuckets.slice(TOP_CATEGORY_COUNT);
  const othersBucket =
    otherCategoryTail.length > 0
      ? otherCategoryTail.reduce(
          (sum, bucket) => ({ spent: sum.spent + bucket.spent, share: sum.share + bucket.share }),
          { spent: 0n, share: 0 },
        )
      : null;

  // The month's latest spends, newest first.
  const recentExpenses = ledger.txns
    .filter((txn) => txn.kind === 'expense' && txn.date.slice(0, 7) === month)
    .slice(0, 4);

  // The money-tools grid: one tile per feature Personal already links to
  // elsewhere on the tab or under Settings. Goals has no screen of its own
  // yet, so it is left out rather than drawn as a dead tile.
  const moneyTools: ToolTileSpec[] = [
    {
      key: 'recurring',
      tint: 'mint',
      icon: 'repeat',
      title: t.personal.recurring,
      subtitle: t.personal.dash.toolRecurringSub,
      onPress: () => router.push('/personal/recurring'),
    },
    {
      key: 'loans',
      tint: 'lilac',
      icon: 'business-outline',
      title: t.personal.loans,
      subtitle: t.personal.dash.toolLoansSub,
      onPress: () => router.push('/personal/loans'),
    },
    {
      key: 'budgets',
      tint: 'peach',
      icon: 'wallet-outline',
      title: t.personal.dash.toolBudgets,
      subtitle: t.personal.dash.toolBudgetsSub,
      onPress: () => router.push('/personal/budgets'),
    },
    {
      key: 'analytics',
      tint: 'sky',
      icon: 'stats-chart-outline',
      title: t.personal.dash.toolAnalytics,
      subtitle: t.personal.dash.toolAnalyticsSub,
      onPress: () => router.push('/personal/spending'),
    },
    {
      key: 'categories',
      tint: 'coral',
      icon: 'pricetags-outline',
      title: t.personal.dash.toolCategories,
      subtitle: t.personal.dash.toolCategoriesSub,
      onPress: () => router.push('/settings/categories'),
    },
  ];

  // Private ledger: while the biometric gate is unresolved the whole screen is a
  // shield — no hero, no figures — so nothing is on show behind the OS prompt.
  // A refused check stays here with a way to try again, rather than sending the
  // user backwards without a word.
  // The tab's own intro, once per account, after the lock has let them in.
  // Keyed on the session's user rather than the profile, which can arrive late
  // or not at all; and held as *which* account it is open for, so a switch to
  // another account never carries the first one's open intro across.
  const ownerId = useViewerId();
  const [introFor, setIntroFor] = useState<string | null>(null);
  const introOpen = introFor !== null && introFor === ownerId;
  useEffect(() => {
    if (!gate.unlocked || !ownerId) return;
    let live = true;
    void personalIntroSeen(ownerId).then((seen) => {
      if (live && !seen) setIntroFor(ownerId);
    });
    return () => {
      live = false;
    };
  }, [gate.unlocked, ownerId]);
  const closeIntro = useCallback(() => {
    setIntroFor(null);
    if (ownerId) void rememberPersonalIntroSeen(ownerId);
  }, [ownerId]);

  if (!gate.unlocked) return <PersonalLocked gate={gate} />;

  // Nothing in the section at all — no entry, no recurring rule, no loan, no
  // budget — and the mirror has finished loading, so that is the truth of it
  // rather than a screen caught mid-hydration. A month of zeroes is a form to
  // fill in with no reason attached; the first run says the promise instead,
  // and everything below comes back the moment there is one record to draw.
  const blank =
    hydrated &&
    ledger.txns.length === 0 &&
    ledger.recurrings.length === 0 &&
    ledger.loans.length === 0 &&
    ledger.budgets.length === 0;
  if (blank) {
    return (
      <>
        <PersonalFirstRun t={t} />
        <PersonalIntro visible={introOpen} onDone={closeIntro} />
      </>
    );
  }

  const canBrowse = maxBack > 0;
  const monthItems: OverflowMenuItem[] = Array.from(
    // Every month back to the first one with an entry; the menu scrolls.
    { length: maxBack + 1 },
    (_, back) => ({
      icon: back === monthsBack ? 'checkmark' : 'calendar-outline',
      label: monthLabel(shiftMonth(currentMonth, -back), locale),
      onPress: () => setMonthsBack(back),
    }),
  );

  return (
    <Screen edges={[]}>
      {/* The scene runs up under the status bar, so the clock goes white — but
          only here, where the scene is drawn: the lock shield and the first run
          are plain pages, and keep the theme's own dark icons. */}
      <HeroStatusBar />
      <Animated.ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: clearance }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
        })}
      >
        {/* The scene, from under the status bar down to the lower part of the
            month tiles, where it fades into the page. Wrapped as the glass
            tiles' blur target (Android needs one). */}
        <BlurTargetView
          ref={sceneRef}
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: sceneHeight }}
        >
          <PersonalHeroBackground
            scene={scene}
            height={sceneHeight}
            horizon={tilesTop}
            pageColor={theme.color.bg}
          />
        </BlurTargetView>

        <View
          onLayout={(event) => setHeroHeight(event.nativeEvent.layout.height)}
          style={{
            paddingTop: insets.top + theme.spacing.sm,
            paddingHorizontal: theme.spacing.lg,
            paddingBottom: HERO_OVERLAP + theme.spacing.lg,
            gap: theme.spacing.xl,
          }}
        >
          {/* Face, the section's name and its line; then search, add, lock. */}
          <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <HeroAvatar
              name={profile?.display_name ?? t.account.you}
              photoUrl={avatarUrl}
              onPress={() => router.navigate('/profile')}
              label={t.profile}
            />
            <View style={{ flex: 1, minWidth: 0, marginEnd: theme.spacing.xs }}>
              <Text
                tone="onBrand"
                numberOfLines={1}
                style={{ fontSize: 22, lineHeight: 27, fontWeight: '800' }}
              >
                {t.personal.title}
              </Text>
              <Text variant="caption" tone="onBrand" numberOfLines={1} style={{ opacity: 0.9 }}>
                {t.personal.dash.tagline}
              </Text>
            </View>
            <HeroIconButton
              icon="search-outline"
              label={t.personal.transactions}
              onPress={() => router.push('/personal/transactions')}
            />
            <HeroIconButton
              icon="add-circle-outline"
              label={t.personal.addExpense}
              onPress={() =>
                router.push({ pathname: '/personal/entry', params: { kind: 'expense' } })
              }
            />
            <HeroIconButton
              icon="settings-outline"
              label={t.account.faceSettings}
              onPress={() => setGearOpen(true)}
            />
          </Row>
        </View>

        <View
          style={{
            paddingHorizontal: theme.spacing.lg,
            marginTop: -HERO_OVERLAP,
            gap: theme.spacing.lg,
          }}
        >
          {/* The month's whole headline — the spend, how it moved, a short
              history, and the three figures beneath it — blended into the
              scene's foot in one card, exactly like Home's balance card. */}
          <View onLayout={(event) => setTilesHeight(event.nativeEvent.layout.height)}>
            <GlassSurface blurTarget={sceneRef} style={{ padding: theme.spacing.lg }}>
              <View style={{ gap: theme.spacing.lg }}>
                <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
                  <Row
                    style={{ flex: 1, minWidth: 0, alignItems: 'center', gap: theme.spacing.sm }}
                  >
                    <Text variant="body" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                      {monthsBack === 0
                        ? t.personal.dash.totalSpentThisMonth
                        : fill(t.personal.dash.totalSpentIn, { month: monthLabel(month, locale) })}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        amountsHidden ? t.dashHero.showBalance : t.dashHero.hideBalance
                      }
                      onPress={toggleAmountsHidden}
                      hitSlop={10}
                      style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                    >
                      <Ionicons
                        name={amountsHidden ? 'eye-off-outline' : 'eye-outline'}
                        size={iconSize.md}
                        color={theme.color.textMuted}
                      />
                    </Pressable>
                  </Row>
                  <MonthPill
                    label={monthLabel(month, locale)}
                    spokenLabel={t.personal.dash.pickMonth}
                    onPress={canBrowse ? () => setMonthMenuOpen(true) : undefined}
                  />
                </Row>

                <Row style={{ alignItems: 'flex-start', gap: theme.spacing.md }}>
                  <View style={{ flex: 1, minWidth: 0, gap: theme.spacing.xs }}>
                    {amountsHidden ? (
                      <Text numberOfLines={1} style={HEADLINE_STYLE}>
                        {BALANCE_MASK}
                      </Text>
                    ) : (
                      <Text
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.6}
                        style={HEADLINE_STYLE}
                      >
                        {fmt(summary.expense)}
                      </Text>
                    )}
                    {change !== null && !amountsHidden ? (
                      <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
                        <ChangePill change={change} />
                        <Text variant="caption" tone="muted" numberOfLines={1}>
                          {fill(t.personal.dash.vsMonth, {
                            month: monthShortYear(shiftMonth(month, -1), locale),
                          })}
                        </Text>
                      </Row>
                    ) : null}
                  </View>
                  {!amountsHidden ? <SpendHistoryChart values={spendHistory} /> : null}
                </Row>

                <Row style={{ gap: theme.spacing.sm }}>
                  <FlowTile
                    icon="wallet-outline"
                    tone="income"
                    label={t.personal.income}
                    value={fmt(summary.income)}
                    hidden={amountsHidden}
                    // The month's income, entry by entry.
                    onPress={() =>
                      router.push({
                        pathname: '/personal/transactions',
                        params: { kind: 'income', month },
                      })
                    }
                  />
                  <FlowTile
                    icon="arrow-up"
                    tone="negative"
                    label={t.personal.spent}
                    value={fmt(summary.expense)}
                    hidden={amountsHidden}
                    // The month's spends, entry by entry.
                    onPress={() =>
                      router.push({
                        pathname: '/personal/transactions',
                        params: { kind: 'expense', month },
                      })
                    }
                  />
                  <FlowTile
                    icon="wallet"
                    tone="brand"
                    label={t.personal.dash.available}
                    value={`${summary.net < 0n ? '−' : ''}${fmt(summary.net < 0n ? -summary.net : summary.net)}`}
                    negative={summary.net < 0n}
                    hidden={amountsHidden}
                    // What is left and where the rest went: the Spending screen's
                    // own subject, rather than a third copy of the ledger.
                    onPress={() => router.push('/personal/spending')}
                  />
                </Row>
              </View>
            </GlassSurface>
          </View>

          <BudgetCard
            progress={budgetProgress}
            categoryCount={categoryBudgetCount}
            worstOverLine={worstOverLine}
            locale={locale}
            fmt={fmt}
            t={t}
            onPress={() => router.push('/personal/budgets')}
          />

          {/* What this month is still waiting for. The one screen where a
              missed rent or an unpaid EMI is actually actionable: each row goes
              straight to that period's own confirm sheet, prefilled. Only shown
              for the current month — a past month's misses belong in its
              history, not as a to-do list on the way somewhere else. */}
          {monthsBack === 0 && due.length > 0 ? (
            <View style={{ gap: theme.spacing.sm }}>
              <Text variant="caption" tone="muted">
                {t.personal.dueThisMonth}
              </Text>
              {due.map(({ rule, occurrence }) => (
                <Pressable
                  key={`${rule.id}:${occurrence.periodKey}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${rule.note?.trim() || sourceLabel(rule.category) || ''} · ${
                    occurrence.status === 'missed' ? t.personal.missed : t.personal.due
                  }`}
                  onPress={() => router.push(`/personal/source/${rule.id}`)}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                >
                  <Card flat>
                    <Row style={{ gap: theme.spacing.md, alignItems: 'center' }}>
                      <Ionicons
                        name={occurrence.status === 'missed' ? 'alert-circle' : 'ellipse-outline'}
                        size={iconSize.md}
                        color={
                          occurrence.status === 'missed' ? theme.color.negative : theme.color.brand
                        }
                      />
                      <View style={{ flex: 1 }}>
                        <Text variant="body" numberOfLines={1}>
                          {rule.note?.trim() ||
                            sourceLabel(rule.category) ||
                            (rule.txnKind === 'income'
                              ? t.personal.incomeKind
                              : t.personal.expense)}
                        </Text>
                        <Text variant="micro" tone="muted">
                          {fill(t.personal.expectedOn, { date: occurrence.dueDate })}
                        </Text>
                      </View>
                      <Text variant="body" style={{ fontWeight: '700' }}>
                        {rule.txnKind === 'income' ? '+' : '−'}
                        {format(money(occurrence.expected, rule.currency), {
                          locale,
                        })}
                      </Text>
                    </Row>
                  </Card>
                </Pressable>
              ))}
            </View>
          ) : null}

          {categoryBuckets.length > 0 ? (
            <SectionCard
              icon="pie-chart"
              title={t.personal.dash.topCategories}
              subtitle={t.personal.dash.topCategoriesSubtitle}
              action={t.personal.dash.viewAll}
              onAction={() => router.push('/personal/spending')}
            >
              <Row style={{ gap: theme.spacing.lg, alignItems: 'center' }}>
                <CategoryDonut
                  size={124}
                  strokeWidth={15}
                  segments={[
                    ...topCategories.map((category) => ({
                      share: category.share,
                      color: theme.tint[resolveCategory(category.key, null).tint].ink,
                    })),
                    ...(othersBucket
                      ? [{ share: othersBucket.share, color: theme.color.textMuted }]
                      : []),
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.6}
                    style={{ fontSize: 15, lineHeight: 18, fontWeight: '800' }}
                  >
                    {fmt(summary.expense)}
                  </Text>
                  <Text variant="micro" tone="muted" numberOfLines={1}>
                    {t.personal.dash.totalSpent}
                  </Text>
                  {change !== null ? (
                    <Row style={{ alignItems: 'center', gap: 2, marginTop: 2 }}>
                      <Ionicons
                        name={change > 0 ? 'arrow-up' : change < 0 ? 'arrow-down' : 'remove'}
                        size={9}
                        color={
                          change > 0
                            ? theme.color.negative
                            : change < 0
                              ? theme.color.positive
                              : theme.color.textMuted
                        }
                      />
                      <Text
                        variant="micro"
                        numberOfLines={1}
                        style={{
                          fontWeight: '700',
                          color:
                            change > 0
                              ? theme.color.negative
                              : change < 0
                                ? theme.color.positive
                                : theme.color.textMuted,
                        }}
                      >
                        {`${Math.abs(change)}%`}
                      </Text>
                    </Row>
                  ) : null}
                </CategoryDonut>

                <View style={{ flex: 1, minWidth: 0, gap: theme.spacing.sm }}>
                  {topCategories.map((category) => (
                    <TopCategoryRow
                      key={category.key}
                      category={category.key}
                      label={catLabel(category.key) ?? t.categories.other}
                      amount={fmt(category.spent)}
                      share={category.share}
                      onPress={() =>
                        router.push({
                          pathname: '/personal/transactions',
                          params: {
                            category: category.key,
                            categoryMode: 'bucket',
                            kind: 'expense',
                            month,
                          },
                        })
                      }
                    />
                  ))}
                  {othersBucket ? (
                    <TopCategoryRow
                      isOthers
                      label={t.personal.dash.others}
                      amount={fmt(othersBucket.spent)}
                      share={othersBucket.share}
                      onPress={() => router.push('/personal/spending')}
                    />
                  ) : null}
                </View>
              </Row>
            </SectionCard>
          ) : null}

          <SectionCard
            icon="time-outline"
            title={t.personal.dash.recentExpenses}
            subtitle={t.personal.dash.recentExpensesSubtitle}
            action={t.personal.dash.viewAll}
            onAction={() => router.push('/personal/transactions')}
          >
            {recentExpenses.length === 0 ? (
              <Text tone="muted" align="center">
                {t.personal.dash.noExpenses}
              </Text>
            ) : (
              <View>
                {recentExpenses.map((txn, index) => (
                  <View key={txn.id}>
                    {index > 0 ? <Divider /> : null}
                    <ExpenseRow
                      txn={txn}
                      title={txn.note?.trim() || catLabel(txn.category) || '—'}
                      categoryLabel={catLabel(txn.category) ?? t.categories.other}
                      date={txn.date === today ? t.personal.today : dayMonthYear(txn.date, locale)}
                      locale={locale}
                    />
                  </View>
                ))}
              </View>
            )}
          </SectionCard>

          <SectionCard
            icon="layers-outline"
            title={t.personal.dash.moneyTools}
            subtitle={t.personal.dash.moneyToolsSubtitle}
          >
            {/* A 2×3 grid of plain nav tiles — one per money tool Personal
                already links to elsewhere. Chunked into rows of two rather
                than a flex-wrap, so an odd tile out (Categories, with no
                sixth to pair against) stretches to fill its row instead of
                sitting half-width beside empty space. */}
            <View style={{ gap: theme.spacing.sm }}>
              {chunkPairs(moneyTools).map((pair, rowIndex) => (
                <Row key={rowIndex} style={{ gap: theme.spacing.sm, alignItems: 'stretch' }}>
                  {pair.map(({ key, ...tile }) => (
                    <ToolGridTile key={key} {...tile} />
                  ))}
                </Row>
              ))}
            </View>
          </SectionCard>

          <PrivacyFooterPill />
        </View>
      </Animated.ScrollView>
      {/* The status bar stays light over this tab (the scene is under it at
          rest), so once the scene has scrolled away a strip of its own sky fades
          in behind the clock — white icons never sit on the pale page. */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: insets.top,
          backgroundColor: HERO_THEMES[scene].sky[0],
          opacity: scrollY.interpolate({
            inputRange: [0, Math.max(1, tilesTop - insets.top)],
            outputRange: [0, 1],
            extrapolate: 'clamp',
          }),
        }}
      />
      <OverflowMenu
        visible={monthMenuOpen}
        onClose={() => setMonthMenuOpen(false)}
        items={monthItems}
      />
      <OverflowMenu
        visible={gearOpen}
        onClose={() => setGearOpen(false)}
        items={[
          { icon: 'image-outline', label: t.heroScene.title, route: '/settings/scene' },
          { icon: 'lock-closed-outline', label: t.personal.dash.settings, route: '/settings/lock' },
        ]}
      />
      <PersonalIntro visible={introOpen} onDone={closeIntro} />
    </Screen>
  );
}

/** The light status bar the scenic hero needs, as a component so it applies
 *  only while the dashboard (and so the scene) is the thing on screen. */
function HeroStatusBar() {
  useHeroStatusBar();
  return null;
}

/** How far the month tiles ride up over the bottom of the hero. */
const HERO_OVERLAP = 48;

// ─────────────────────────────────────────────────────────────── month ──

// Shift a YYYY-MM by whole calendar months. Date maths on the first of the month
// so day-of-month can never overflow (Date arg, never a bare `new Date()`).
function shiftMonth(month: string, delta: number): string {
  const d = new Date(`${month}-01T00:00:00`);
  d.setMonth(d.getMonth() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Whole months from `from` to `to` (both YYYY-MM); negative if `to` precedes
// `from`. Used to bound backward month navigation to the earliest entry.
function monthsBetween(from: string, to: string): number {
  const [fy = 0, fm = 0] = from.split('-').map(Number);
  const [ty = 0, tm = 0] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

// The month for the header — the reader's own calendar name, or the raw YYYY-MM
// if the platform has no Intl month names.
function monthLabel(month: string, locale: string): string {
  try {
    // UTC on both sides: a cached formatter keeps the zone it was built in, so
    // a local-time date would drift a day (or a month) after a timezone change.
    return dateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${month}-01T00:00:00Z`),
    );
  } catch {
    return month;
  }
}

// ─────────────────────────────────────────────────────────────── hero ──

/** The big headline figure's text style, shared between the live amount and
 *  its mask so neither drifts from the other's size. */
const HEADLINE_STYLE = { fontSize: 32, lineHeight: 38, fontWeight: '800' } as const;

/** How many months the faint bar chart behind the headline covers. */
const SPEND_HISTORY_MONTHS = 7;

/** How many of the month's categories the donut and its list name on their
 *  own before the rest folds into one "Others" row. */
const TOP_CATEGORY_COUNT = 5;

/** How this month's spend moved against last month's: up is red (more went
 *  out), down is green — a tinted chip on the summary card. */
function ChangePill({ change }: { change: number }) {
  const theme = useTheme();
  const up = change > 0;
  const down = change < 0;
  const color = up ? theme.color.negative : down ? theme.color.positive : theme.color.textMuted;
  const bg = up
    ? theme.color.negativeSoft
    : down
      ? theme.color.positiveSoft
      : theme.color.surfaceMuted;
  return (
    <Row
      style={{
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 3,
        borderRadius: theme.radius.pill,
        backgroundColor: bg,
      }}
    >
      <Ionicons
        name={up ? 'arrow-up' : down ? 'arrow-down' : 'remove'}
        size={iconSize.xs}
        color={color}
      />
      <Text variant="caption" style={{ color, fontWeight: '700' }}>
        {`${Math.abs(change)}%`}
      </Text>
    </Row>
  );
}

/** How tall the mini bar chart stands. */
const SPEND_CHART_HEIGHT = 40;

/**
 * The faint bar chart beside the headline: the last several months' spend,
 * each a bar in the card's own brand tint, tallest never taller than the
 * chart itself. Drawn with plain `View`s — a sparkline with no library and
 * nothing to animate, so it costs nothing on the one screen that already
 * blurs a scene behind glass.
 */
function SpendHistoryChart({ values }: { values: readonly bigint[] }) {
  const theme = useTheme();
  if (values.length < 2) return null;
  const max = values.reduce((m, v) => (v > m ? v : m), 0n);
  return (
    <Row
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ alignItems: 'flex-end', gap: 3, height: SPEND_CHART_HEIGHT, paddingBottom: 1 }}
    >
      {values.map((value, index) => {
        const ratio = max > 0n ? Number(value) / Number(max) : 0;
        const height = Math.max(3, Math.round(ratio * (SPEND_CHART_HEIGHT - 3)));
        const latest = index === values.length - 1;
        return (
          <View
            key={index}
            style={{
              width: 6,
              height,
              borderRadius: 3,
              backgroundColor: latest ? theme.color.brand : theme.color.brandSoft,
            }}
          />
        );
      })}
    </Row>
  );
}

/** The month on show, as a white pill — a picker when there are other months
 *  to reach, and just the month's name when there are not. */
function MonthPill({
  label,
  spokenLabel,
  onPress,
}: {
  label: string;
  spokenLabel: string;
  onPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? `${spokenLabel}. ${label}` : label}
      disabled={!onPress}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.xs,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.color.surface,
        maxWidth: 180,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name="calendar-outline" size={iconSize.sm} color={theme.color.text} />
      <Text variant="caption" numberOfLines={1} style={{ flexShrink: 1, fontWeight: '700' }}>
        {label}
      </Text>
      {onPress ? (
        <Ionicons name="chevron-down" size={iconSize.sm} color={theme.color.text} />
      ) : null}
    </Pressable>
  );
}

/** One of the three month figures on the card: a tinted disc, what it is, the
 *  amount, and a chevron — tappable through to where it comes from. Income
 *  wears the blue tint, Spent the red-on-pink pair, Available the brand's own
 *  lilac — the reference's three tile colours. */
function FlowTile({
  icon,
  tone,
  label,
  value,
  negative = false,
  hidden = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: 'income' | 'negative' | 'brand';
  label: string;
  value: string;
  /** The figure is below zero — drawn in the negative colour. */
  negative?: boolean;
  /** The eye is shut: show the mask in place of the amount. */
  hidden?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const ink =
    tone === 'income'
      ? theme.tint.sky.ink
      : tone === 'negative'
        ? theme.color.negative
        : theme.color.brand;
  const soft =
    tone === 'income'
      ? theme.tint.sky.bg
      : tone === 'negative'
        ? theme.color.negativeSoft
        : theme.color.brandSoft;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hidden ? label : `${label}. ${value}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 0,
        gap: 2,
        padding: theme.spacing.sm,
        borderRadius: theme.radius.lg,
        backgroundColor: soft,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: ink,
          }}
        >
          <Ionicons name={icon} size={iconSize.sm} color="#FFFFFF" />
        </View>
        <Ionicons
          name={directionalIcon('chevron-forward')}
          size={iconSize.sm}
          color={theme.color.textMuted}
        />
      </Row>
      <Text variant="caption" numberOfLines={1} style={{ color: ink, marginTop: theme.spacing.xs }}>
        {label}
      </Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        style={{
          fontSize: 16,
          lineHeight: 21,
          fontWeight: '800',
          color: hidden ? theme.color.text : negative ? theme.color.negative : theme.color.text,
        }}
      >
        {hidden ? BALANCE_MASK : value}
      </Text>
    </Pressable>
  );
}

// ──────────────────────────────────────────────────────────────── body ──

/** A white card with a titled header — a tinted disc, the title (with an
 *  optional one-line subtitle under it), and an optional "View all" link on
 *  the right. */
function SectionCard({
  icon,
  title,
  subtitle,
  action,
  onAction,
  trailing,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  /** A short one-line line under the title, the way the reference's cards
   *  each say what the card is for ("Where your money goes this month"). */
  subtitle?: string;
  action?: string;
  onAction?: () => void;
  /** Drawn at the header's end in place of a link. */
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Card style={{ gap: theme.spacing.lg, padding: theme.spacing.lg }}>
      <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.brandSoft,
          }}
        >
          <Ionicons name={icon} size={iconSize.md} color={theme.color.brand} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <Text variant="subheading" numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {trailing}
        {action && onAction ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${action}, ${title}`}
            onPress={onAction}
            hitSlop={8}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 2,
              opacity: pressed ? 0.5 : 1,
            })}
          >
            <Text variant="caption" tone="brand" style={{ fontWeight: '600' }}>
              {action}
            </Text>
            <Ionicons
              name={directionalIcon('chevron-forward')}
              size={iconSize.sm}
              color={theme.color.brand}
            />
          </Pressable>
        ) : null}
      </Row>
      {children}
    </Card>
  );
}

/** The overall monthly cap: how much of it the month has used, as a figure and
 *  a bar. With no cap set, an invitation to set one. */
function BudgetCard({
  progress,
  categoryCount,
  worstOverLine,
  locale,
  fmt,
  t,
  onPress,
}: {
  progress: { spent: bigint; limit: bigint; ratio: number } | null;
  /** Budgets on single categories — spoken for when there is no overall cap. */
  categoryCount: number;
  /** "Food: ₹2,000 over" for the category furthest past its cap, or null. */
  worstOverLine: string | null;
  locale: string;
  fmt: (amount: bigint) => string;
  t: ReturnType<typeof useStrings>['t'];
  onPress: () => void;
}) {
  const theme = useTheme();
  const percent = progress ? Math.round(progress.ratio * 100) : 0;
  const over = percent > 100;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        progress
          ? `${t.personal.dash.monthlyBudget}. ${fmt(progress.spent)} ${fill(t.personal.dash.budgetOf, { limit: fmt(progress.limit) })}. ${percent}% ${t.personal.dash.spentShort}`
          : categoryCount > 0
            ? `${t.personal.dash.monthlyBudget}. ${plural(locale, categoryCount, t.personal.dash.categoryBudgets)}. ${worstOverLine ?? t.personal.dash.allWithin}`
            : t.personal.dash.setBudget
      }
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <SectionCard
        icon="radio-button-on"
        title={t.personal.dash.monthlyBudget}
        trailing={
          progress ? (
            <Row style={{ alignItems: 'center', gap: 2 }}>
              <Text variant="caption" numberOfLines={1}>
                <Text variant="caption" style={{ fontWeight: '800' }}>
                  {fmt(progress.spent)}
                </Text>
                <Text variant="caption" tone="muted">
                  {` ${fill(t.personal.dash.budgetOf, { limit: fmt(progress.limit) })}`}
                </Text>
              </Text>
              <Ionicons
                name={directionalIcon('chevron-forward')}
                size={iconSize.sm}
                color={theme.color.textMuted}
              />
            </Row>
          ) : (
            <Ionicons
              name={directionalIcon('chevron-forward')}
              size={iconSize.sm}
              color={theme.color.brand}
            />
          )
        }
      >
        {progress ? (
          <Row style={{ alignItems: 'center', gap: theme.spacing.lg }}>
            <View
              style={{
                flex: 1,
                height: 12,
                borderRadius: 6,
                backgroundColor: theme.color.surfaceMuted,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  width: `${Math.min(100, percent)}%`,
                  height: 12,
                  borderRadius: 6,
                  backgroundColor: over ? theme.color.negative : theme.color.brand,
                }}
              />
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text
                style={{
                  fontSize: 20,
                  lineHeight: 24,
                  fontWeight: '800',
                  color: over ? theme.color.negative : theme.color.text,
                }}
              >
                {`${percent}%`}
              </Text>
              <Text variant="micro" tone="muted">
                {t.personal.dash.spentShort}
              </Text>
            </View>
          </Row>
        ) : categoryCount > 0 ? (
          // No overall cap, but category budgets: say how many, and whether any
          // has run over — the one thing on this card worth acting on.
          <View style={{ gap: 2 }}>
            <Text variant="body" style={{ fontWeight: '700' }}>
              {plural(locale, categoryCount, t.personal.dash.categoryBudgets)}
            </Text>
            <Text
              variant="caption"
              style={{
                color: worstOverLine ? theme.color.negative : theme.color.positive,
                fontWeight: '600',
              }}
            >
              {worstOverLine ?? t.personal.dash.allWithin}
            </Text>
          </View>
        ) : (
          <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="body" tone="brand" style={{ fontWeight: '700' }}>
                {t.personal.dash.setBudget}
              </Text>
              <Text variant="caption" tone="muted">
                {t.personal.dash.setBudgetHint}
              </Text>
            </View>
            <BudgetJarArt />
          </Row>
        )}
      </SectionCard>
    </Pressable>
  );
}

/** The budget card's jar-of-coins, for the invitation state only — a soft
 *  lavender jar with a coin peeking over its rim, themed off the lilac tint
 *  so it sits quietly beside "Set a monthly budget" rather than competing
 *  with it. */
function BudgetJarArt() {
  const theme = useTheme();
  const tint = theme.tint.lilac;
  return (
    <Svg
      width={56}
      height={56}
      viewBox="0 0 64 64"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Rect
        x={14}
        y={24}
        width={36}
        height={32}
        rx={10}
        fill={tint.bg}
        stroke={tint.ink}
        strokeWidth={2}
      />
      <Path d="M20 34 H44" stroke={tint.ink} strokeWidth={2} strokeLinecap="round" opacity={0.5} />
      <Path d="M20 42 H44" stroke={tint.ink} strokeWidth={2} strokeLinecap="round" opacity={0.5} />
      <Rect
        x={20}
        y={14}
        width={24}
        height={10}
        rx={5}
        fill={tint.bg}
        stroke={tint.ink}
        strokeWidth={2}
      />
      <Circle cx={26} cy={14} r={6} fill={theme.color.brand} />
      <Circle cx={36} cy={10} r={6} fill={theme.color.brand} />
      <Circle cx={32} cy={18} r={6} fill={tint.bg} stroke={theme.color.brand} strokeWidth={1.5} />
    </Svg>
  );
}

/**
 * The donut behind the top-categories card: one ring segment per category
 * (plus one for the "Others" tail), each coloured with that category's own
 * tint so the chart and the list beside it read as the same breakdown. Drawn
 * as stacked `Circle`s with a `strokeDasharray`/`strokeDashoffset` pair —
 * the same plain-primitives approach as the bar sparkline above, no charting
 * library — rotated -90° so the first segment starts at twelve o'clock. The
 * centre is free for whatever the caller wants to say about the whole month.
 */
function CategoryDonut({
  size,
  strokeWidth,
  segments,
  children,
}: {
  size: number;
  strokeWidth: number;
  segments: readonly { share: number; color: string }[];
  children: ReactNode;
}) {
  const theme = useTheme();
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const cx = size / 2;
  const cy = size / 2;
  // Each arc's length and where it starts, built with a fold rather than a
  // running total mutated inside the map below — the React compiler forbids
  // reassigning a render-local variable from inside a callback.
  const arcs = segments.reduce<{ color: string; dash: number; offset: number }[]>(
    (acc, segment) => {
      if (segment.share <= 0) return acc;
      const drawnSoFar =
        acc.length > 0 ? acc[acc.length - 1]!.offset + acc[acc.length - 1]!.dash : 0;
      const dash = segment.share * circumference;
      acc.push({ color: segment.color, dash, offset: drawnSoFar });
      return acc;
    },
    [],
  );
  return (
    <View style={{ width: size, height: size }}>
      <Svg
        width={size}
        height={size}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          stroke={theme.color.surfaceMuted}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {arcs.map((arc, index) => (
          <Circle
            key={index}
            cx={cx}
            cy={cy}
            r={r}
            stroke={arc.color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${arc.dash} ${circumference - arc.dash}`}
            strokeDashoffset={circumference - arc.offset}
            fill="none"
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        ))}
      </Svg>
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { alignItems: 'center', justifyContent: 'center', paddingHorizontal: strokeWidth },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

/** One row of the top-categories list: a tinted badge, the name, its amount
 *  and share, and a chevron through to that category's spends. `isOthers`
 *  swaps the badge for a plain dot — the aggregate row has no one category to
 *  draw an icon for. */
function TopCategoryRow({
  category,
  label,
  amount,
  share,
  isOthers = false,
  onPress,
}: {
  category?: string;
  label: string;
  amount: string;
  share: number;
  isOthers?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const percent = Math.round(share * 100);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${amount}, ${percent}%`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        paddingVertical: theme.spacing.xs,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {isOthers ? (
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.surfaceMuted,
          }}
        >
          <Ionicons name="ellipsis-horizontal" size={iconSize.xs} color={theme.color.textMuted} />
        </View>
      ) : (
        <CategoryBadge category={category} meta={null} size={28} />
      )}
      <Text variant="caption" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
        {label}
      </Text>
      <Text variant="caption" numberOfLines={1} style={{ fontWeight: '700' }}>
        {amount}
        <Text variant="micro" tone="muted">{` · ${percent}%`}</Text>
      </Text>
      <Ionicons
        name={directionalIcon('chevron-forward')}
        size={iconSize.xs}
        color={theme.color.textMuted}
      />
    </Pressable>
  );
}

/** One recent spend: its badge, what it was and when, its category as a chip,
 *  and the amount. Opens the entry. */
function ExpenseRow({
  txn,
  title,
  categoryLabel,
  date,
  locale,
}: {
  txn: PersonalTxn;
  title: string;
  categoryLabel: string;
  date: string;
  locale: string;
}) {
  const theme = useTheme();
  const tint = theme.tint[resolveCategory(txn.category ?? 'other', null).tint];
  const expense = txn.kind === 'expense';
  const amount = `${expense ? '−' : '+'}${format(money(txn.amount, txn.currency), { locale })}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${categoryLabel}, ${date}, ${amount}`}
      onPress={() => router.push({ pathname: '/personal/entry', params: { id: txn.id } })}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        minHeight: 52,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <CategoryBadge
        category={txn.category ?? 'other'}
        meta={null}
        description={txn.note}
        size={40}
      />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant="body" numberOfLines={1} style={{ fontWeight: '600' }}>
          {title}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {date}
        </Text>
      </View>
      <View
        style={{
          paddingHorizontal: theme.spacing.sm,
          paddingVertical: 2,
          borderRadius: theme.radius.pill,
          backgroundColor: tint.bg,
          maxWidth: 96,
        }}
      >
        <Text variant="micro" numberOfLines={1} style={{ color: tint.ink, fontWeight: '600' }}>
          {categoryLabel}
        </Text>
      </View>
      <Text
        variant="body"
        numberOfLines={1}
        style={{ fontWeight: '700', color: expense ? theme.color.negative : theme.color.positive }}
      >
        {amount}
      </Text>
      <Ionicons
        name={directionalIcon('chevron-forward')}
        size={iconSize.sm}
        color={theme.color.textMuted}
      />
    </Pressable>
  );
}

/** One tile of the money-tools grid: round icon, title, a chevron, and a
 *  one-line subtitle naming what it's for. */
interface ToolTileSpec {
  readonly key: string;
  readonly tint: TintName;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly title: string;
  readonly subtitle: string;
  readonly onPress: () => void;
}

/** `moneyTools` chunked into rows of two, for the grid below. The last row is
 *  shorter than two when the tile count is odd (no filler tile is invented to
 *  square it off). */
function chunkPairs<T>(items: readonly T[]): T[][] {
  const pairs: T[][] = [];
  for (let i = 0; i < items.length; i += 2) pairs.push(items.slice(i, i + 2));
  return pairs;
}

function ToolGridTile({ tint: tintName, icon, title, subtitle, onPress }: ToolTileSpec) {
  const theme = useTheme();
  const tint = theme.tint[tintName];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        padding: theme.spacing.sm,
        borderRadius: theme.radius.lg,
        backgroundColor: tint.bg,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.color.surface,
        }}
      >
        <Ionicons name={icon} size={iconSize.md} color={tint.ink} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="caption" numberOfLines={1} style={{ fontWeight: '700' }}>
          {title}
        </Text>
        <Text variant="micro" tone="muted" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Ionicons name={directionalIcon('chevron-forward')} size={iconSize.sm} color={tint.ink} />
    </Pressable>
  );
}

// A month as "Aug 2026", for the comparison under the hero figure.
function monthShortYear(month: string, locale: string): string {
  try {
    return dateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${month}-01T00:00:00Z`),
    );
  } catch {
    return month;
  }
}

// A day as "2 Sep 2026", for the recent expenses.
function dayMonthYear(date: string, locale: string): string {
  try {
    return dateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${date}T00:00:00Z`));
  } catch {
    return date;
  }
}

/**
 * The edge-to-edge ground every version of the hero stands on: the saturated
 * wash under the status bar, its rounded foot, and the one wallet watermark
 * bled off the corner. Shared so the first run looks like the same section as
 * the month panel it becomes.
 */
function HeroShell({ wash, children }: { wash: readonly string[]; children: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingTop: insets.top + theme.spacing.md,
        paddingHorizontal: theme.spacing.xl,
        paddingBottom: theme.spacing.lg,
        borderBottomLeftRadius: theme.radius.xxl,
        borderBottomRightRadius: theme.radius.xxl,
        gap: theme.spacing.lg,
        overflow: 'hidden',
      }}
    >
      {/* The saturated ground. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Gradient colors={wash} radius={0} style={{ flex: 1 }} />
      </View>
      {/* One faint watermark bled off the corner. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Ionicons
          name={HERO_GLYPH}
          size={208}
          color={theme.color.onBrand}
          style={{ position: 'absolute', right: -44, bottom: -52, opacity: 0.16 }}
        />
      </View>
      {children}
    </View>
  );
}

/**
 * The way into the ledger on the hero: one "+ Expense" pill, the dashboard's
 * and a group's own. Income is not a second button — the entry screen opens on
 * an Expense / Income switch, so an earning is one tap further in.
 */
function AddActions({ t }: { t: ReturnType<typeof useStrings>['t'] }) {
  const theme = useTheme();
  return (
    <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
      <HeroPill
        icon="add"
        // The plus does the verb's work; spoken, it is still the whole action.
        label={t.expenseShort}
        spokenLabel={t.personal.addExpense}
        onPress={() => router.push({ pathname: '/personal/entry', params: { kind: 'expense' } })}
      />
    </Row>
  );
}

/**
 * The first run: the section with nothing in it yet.
 *
 * A private ledger asks for real work — every entry is typed by hand — so the
 * empty screen has to be worth the first one. It leads with what the month's
 * figures would eventually say ("see what you keep each month") rather than
 * with the figures themselves at zero, keeps the same saturated panel so the
 * tab is recognisably itself, and offers the three doors in the order a person
 * needs them: spend, earn, and the recurring rules that mean salary and rent
 * post themselves from here on.
 *
 * The privacy line stays, and stays early: the one question anybody has about
 * a personal ledger inside a bill-splitting app is who else can see it.
 */
function PersonalFirstRun({ t }: { t: ReturnType<typeof useStrings>['t'] }) {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  return (
    <Screen edges={[]}>
      <HeroShell wash={SAVED_WASH}>
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="title" tone="onBrand" numberOfLines={1}>
            {t.personal.title}
          </Text>
          <Text variant="caption" tone="onBrand" numberOfLines={2} style={{ opacity: 0.85 }}>
            {t.personal.subtitle}
          </Text>
        </View>
        <AddActions t={t} />
      </HeroShell>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: clearance }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: theme.spacing.xl, gap: theme.spacing.xl }}>
          <EmptyState
            icon={<Ionicons name={HERO_GLYPH} size={iconSize.xxl} color={theme.color.brand} />}
            title={t.personal.introTitle}
            body={t.personal.introBody}
            action={
              <Button
                label={t.personal.addRecurring}
                variant="secondary"
                onPress={() => router.push('/personal/recurring')}
              />
            }
          />
          <PrivateNote />
        </View>
      </ScrollView>
    </Screen>
  );
}

/** An add action on the hero — a pill that shares the row evenly. `solid` is the
 *  primary white pill with brand ink; `ghost` is a translucent secondary in white
 *  ink, so both actions read as buttons and neither is an unlabelled glyph. */
function HeroPill({
  icon,
  label,
  spokenLabel,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  spokenLabel?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const ink = theme.color.brand;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spokenLabel ?? label}
      onPress={onPress}
      // Hugs its word, like the dashboard's pill, rather than filling the row.
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing.xs,
        // Two lots of `md` over a 22pt line: 46pt, clear of the 44pt floor a
        // finger needs. The dashboard's pill is built to the same measure.
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        borderRadius: theme.radius.pill,
        backgroundColor: '#FFFFFF',
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Ionicons name={icon} size={iconSize.lg} color={ink} />
      <Text variant="subheading" style={{ color: ink }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A quiet reassurance, on every state of the tab: this ledger is nobody
 *  else's. The one question a private ledger inside a shared-expense app has to
 *  answer, so it is answered whether or not there is anything in it yet. */
function PrivateNote() {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <Row style={{ justifyContent: 'center', gap: theme.spacing.xs }}>
      <Ionicons name="lock-closed-outline" size={iconSize.xs} color={theme.color.textFaint} />
      <Text variant="micro" tone="faint">
        {t.personal.privateNote}
      </Text>
    </Row>
  );
}

/**
 * The same reassurance as `PrivateNote`, but said once at the foot of the
 * dashboard proper as a lavender strip rather than a quiet caption — closer
 * to a pressable fact than a footnote. Opens the backup screen, which is the
 * one place that actually explains what "not shared" means for this ledger
 * (where its backup lives and whose key locks it); where that door does not
 * make sense (the first run, with nothing backed up yet) the plain
 * `PrivateNote` is still the right weight.
 */
function PrivacyFooterPill() {
  const theme = useTheme();
  const { t } = useStrings();
  const tint = theme.tint.lilac;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t.personal.privateNote}
      onPress={() => router.push('/settings/backup')}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        borderRadius: theme.radius.pill,
        backgroundColor: tint.bg,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name="lock-closed" size={iconSize.sm} color={tint.ink} />
      <Text
        variant="caption"
        numberOfLines={1}
        style={{ flex: 1, minWidth: 0, color: tint.ink, fontWeight: '600' }}
      >
        {t.personal.privateNote}
      </Text>
      <Ionicons name={directionalIcon('chevron-forward')} size={iconSize.sm} color={tint.ink} />
    </Pressable>
  );
}

// The translated label for a category id (built-in key or custom tag id). Custom
// tags fall back to their own stored label via the badge; here we only need the
// built-in names, so an unknown id returns null and the row shows its note.
function labelForCategory(t: ReturnType<typeof useStrings>['t']) {
  return (id: string | null): string | null =>
    id ? (t.categories[id as keyof typeof t.categories] ?? null) : null;
}
