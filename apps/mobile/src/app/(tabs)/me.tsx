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
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  cashflowTrend,
  dayPlan,
  format,
  formatParts,
  money,
  monthOutlook,
  personalBudgetProgress,
  recentMonths,
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
} from '@waves/ui';

import { CategoryBadge } from '@/components/Category';
import { BALANCE_MASK } from '@/components/home/HomeBalanceCard';
import {
  BudgetSummary,
  ChangePill,
  FlowTile,
  SpendHistoryChart,
} from '@/components/home/MonthParts';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { TabHeader, TabIconButton } from '@/components/home/TabHeader';
import { PersonAvatar } from '@/components/PersonAvatar';
import { PersonalIntro } from '@/components/PersonalIntro';
import { PersonalPlanCards } from '@/components/PersonalPlanCards';
import {
  CardTitle,
  MoneyToolsRow,
  PersonalUpcomingCard,
  QuickActions,
  usePersonalUpcoming,
} from '@/components/personal/PersonalHomeParts';
import { hasDue } from '@/lib/personalUpcoming';
import { personalIntroSeen, rememberPersonalIntroSeen } from '@/lib/onboardingSeen';
import { useAvatarUrl } from '@/components/ProfileAvatar';
import { useViewerIdentity } from '@/lib/viewerIdentity';
import { SignInWall } from '@/components/SignInWall';
import {
  postDueRecurring,
  todayIso,
  usePersonalLedger,
  useUpsertPersonalRecord,
} from '@/data/personal';
import { usePersonalAmountsHidden } from '@/lib/amountsHidden';
import { useDefaultCurrency } from '@/lib/currency';
import { dateTimeFormat } from '@/lib/dateTimeFormat';
import { useAuth, useViewerId } from '@/lib/auth';
import { router, switchTab } from '@/lib/navigation';
import { useSync } from '@/sync';
import { fill, plural, useStrings } from '@/i18n';

// The first run's saturated wash, deep enough to hold white ink on every corner.
const SAVED_WASH = ['#1E5A8C', '#0C2E4A'] as const;

// One faint watermark glyph, bled off the hero's corner.
const HERO_GLYPH = 'wallet-outline' as const;

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
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const dc = useDefaultCurrency();
  const { hydrated } = useSync();
  const { profile } = useAuth();
  const viewerFace = useViewerIdentity();
  const avatarUrl = useAvatarUrl(viewerFace.avatarUrl);
  const ledger = usePersonalLedger();
  const upsert = useUpsertPersonalRecord();
  // The eye on the summary card: masks every figure on it (and the three
  // tiles beneath it), the same privacy the dashboard's own eye gives Home.
  const { hidden: amountsHidden, toggle: toggleAmountsHidden } = usePersonalAmountsHidden();

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

  const [gearOpen, setGearOpen] = useState(false);

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
  // Whole-rupee totals drop a bare ".00"; real paise still show.
  const fmt = (amount: bigint): string => {
    const p = formatParts(money(amount, dc), { locale });
    return /[1-9]/.test(p.fraction) ? p.text : p.lead + p.trail;
  };
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
  const historyLabels = recentMonths(month, SPEND_HISTORY_MONTHS).map((m) => monthShort(m, locale));

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

  // The latest three entries, newest first (the ledger comes newest-first).
  const recentTxns = ledger.txns.slice(0, 3);

  const h = t.personalHome;
  const plan = {
    txns: ledger.txns,
    recurrings: ledger.recurrings,
    budgets: ledger.budgets,
    currency: dc,
    today,
  };
  const perDay = monthsBack === 0 ? (dayPlan(plan)?.perDay ?? 0n) : 0n;
  const upcomingRows = usePersonalUpcoming(
    { txns: ledger.txns, recurrings: ledger.recurrings, currency: dc, today },
    3,
  );
  const [switchOpen, setSwitchOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const firstName = (profile?.display_name ?? t.account.you).trim().split(/\s+/)[0];

  const moreItems: OverflowMenuItem[] = [
    {
      icon: 'document-text-outline',
      label: t.statementImport.title,
      route: '/captures/statement',
    },
    {
      icon: 'pricetags-outline',
      label: t.personal.dash.toolCategories,
      route: '/settings/categories',
    },
    {
      icon: 'mic-outline',
      label: h.moreVoice,
      route: { pathname: '/voice', params: { scope: 'personal' } },
    },
  ];

  // The tab's own intro, once per account, once they are in.
  // Keyed on the session's user rather than the profile, which can arrive late
  // or not at all; and held as *which* account it is open for, so a switch to
  // another account never carries the first one's open intro across.
  const ownerId = useViewerId();
  const [introFor, setIntroFor] = useState<string | null>(null);
  const introOpen = introFor !== null && introFor === ownerId;
  useEffect(() => {
    if (!ownerId) return;
    let live = true;
    void personalIntroSeen(ownerId).then((seen) => {
      if (live && !seen) setIntroFor(ownerId);
    });
    return () => {
      live = false;
    };
  }, [ownerId]);
  const closeIntro = useCallback(() => {
    setIntroFor(null);
    if (ownerId) void rememberPersonalIntroSeen(ownerId);
  }, [ownerId]);

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
        <OpenSetupOnce />
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
      <TabHeader
        left={
          <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <PersonAvatar
              name={profile?.display_name ?? t.account.you}
              avatarUrl={avatarUrl}
              size={44}
              accessibilityLabel={t.profile}
              onPress={() => router.navigate('/profile')}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                accessibilityRole="header"
                numberOfLines={1}
                style={{ fontSize: 18, lineHeight: 23, fontWeight: '700' }}
              >
                {fill(h.hi, { name: firstName ?? '' })}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${h.switchSpace}. ${h.space}`}
                onPress={() => setSwitchOpen(true)}
                hitSlop={6}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 2,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {h.space}
                </Text>
                <Ionicons name="chevron-down" size={iconSize.sm} color={theme.color.textMuted} />
              </Pressable>
            </View>
          </Row>
        }
      >
        <TabIconButton
          icon="search-outline"
          label={h.search}
          onPress={() => router.push('/personal/transactions')}
        />
        <TabIconButton
          icon="notifications-outline"
          label={h.reminders}
          dot={hasDue(upcomingRows)}
          onPress={() => router.push('/personal/upcoming')}
        />
        <TabIconButton
          icon="settings-outline"
          label={h.settings}
          onPress={() => setGearOpen(true)}
        />
      </TabHeader>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: clearance }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            paddingHorizontal: theme.spacing.lg,
            paddingTop: theme.spacing.xs,
            gap: theme.spacing.md,
          }}
        >
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
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                  style={HEADLINE_STYLE}
                >
                  {amountsHidden ? BALANCE_MASK : fmt(summary.expense)}
                </Text>
                {change !== null && !amountsHidden ? (
                  <Row style={{ alignItems: 'center', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
                    <ChangePill change={change} />
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      {fill(t.personal.dash.vsMonth, {
                        month: monthShortYear(shiftMonth(month, -1), locale),
                      })}
                    </Text>
                  </Row>
                ) : null}
              </View>
              {!amountsHidden ? (
                <SpendHistoryChart values={spendHistory} labels={historyLabels} />
              ) : null}
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
                // What is left and where the rest went: the Spending screen's own subject.
                onPress={() => router.push('/personal/spending')}
              />
            </Row>
          </Card>

          {monthsBack === 0 ? (
            <PersonalPlanCards plan={plan} ownerId={ownerId} hidden={amountsHidden} only="recap" />
          ) : null}

          <QuickActions
            tiles={[
              {
                key: 'expense',
                tone: 'brand',
                icon: 'add',
                label: t.personal.addExpense,
                onPress: () =>
                  router.push({ pathname: '/personal/entry', params: { kind: 'expense' } }),
              },
              {
                key: 'income',
                tone: 'positive',
                icon: 'arrow-down',
                label: t.personal.addIncome,
                onPress: () =>
                  router.push({ pathname: '/personal/entry', params: { kind: 'income' } }),
              },
              {
                key: 'loan',
                tone: 'brand',
                icon: 'layers-outline',
                label: h.loan,
                onPress: () => router.push('/personal/loans'),
              },
              {
                key: 'recurring',
                tone: 'brand',
                icon: 'repeat',
                label: t.personal.recurring,
                onPress: () => router.push('/personal/recurring'),
              },
              {
                key: 'reminder',
                tone: 'brand',
                icon: 'notifications-outline',
                label: h.reminder,
                onPress: () => router.push('/dates/edit'),
              },
            ]}
          />

          <Card style={{ gap: theme.spacing.md, padding: theme.spacing.lg }}>
            <CardTitle title={t.personal.thisMonth}>
              <MonthPill
                label={monthLabel(month, locale)}
                spokenLabel={t.personal.dash.pickMonth}
                onPress={canBrowse ? () => setMonthMenuOpen(true) : undefined}
              />
            </CardTitle>
            {budgetProgress ? (
              <BudgetSummary
                progress={budgetProgress}
                perDay={perDay}
                hidden={amountsHidden}
                fmt={fmt}
                t={t}
                onPress={() => router.push('/personal/budgets')}
              />
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.personal.dash.setBudget}
                onPress={() => router.push('/personal/budgets')}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, gap: 2 })}
              >
                <Text variant="body" tone="brand" style={{ fontWeight: '700' }}>
                  {t.personal.dash.setBudget}
                </Text>
                <Text variant="caption" tone="muted">
                  {categoryBudgetCount > 0
                    ? `${plural(locale, categoryBudgetCount, t.personal.dash.categoryBudgets)}. ${worstOverLine ?? t.personal.dash.allWithin}`
                    : t.personal.dash.setBudgetHint}
                </Text>
              </Pressable>
            )}
            {monthsBack === 0 ? (
              <PersonalPlanCards plan={plan} ownerId={ownerId} hidden={amountsHidden} only="tip" />
            ) : null}
          </Card>

          <PersonalUpcomingCard
            rows={upcomingRows}
            fmt={(amount, currency) =>
              amountsHidden ? BALANCE_MASK : format(money(amount, currency), { locale })
            }
          />

          <Card style={{ gap: theme.spacing.sm, padding: theme.spacing.lg }}>
            <CardTitle
              title={h.recentTitle}
              action={t.personal.dash.viewAll}
              onAction={() => router.push('/personal/transactions')}
            />
            {recentTxns.length === 0 ? (
              <Text tone="muted" align="center">
                {t.personal.dash.noExpenses}
              </Text>
            ) : (
              <View>
                {recentTxns.map((txn, index) => (
                  <View key={txn.id}>
                    {index > 0 ? <Divider /> : null}
                    <ExpenseRow
                      txn={txn}
                      title={txn.note?.trim() || catLabel(txn.category) || '—'}
                      categoryLabel={catLabel(txn.category) ?? t.categories.other}
                      date={txn.date === today ? t.personal.today : dayMonthYear(txn.date, locale)}
                      locale={locale}
                      hidden={amountsHidden}
                    />
                  </View>
                ))}
              </View>
            )}
          </Card>

          <Card style={{ gap: theme.spacing.sm, padding: theme.spacing.lg }}>
            {/* Only tools the quick actions above don't already offer. */}
            <CardTitle title={t.personal.dash.moneyTools} />
            <MoneyToolsRow
              tiles={[
                {
                  key: 'budgets',
                  tint: 'lilac',
                  icon: 'speedometer-outline',
                  label: t.personal.dash.toolBudgets,
                  onPress: () => router.push('/personal/budgets'),
                },
                {
                  key: 'spending',
                  tint: 'sky',
                  icon: 'pie-chart-outline',
                  label: t.personal.nav.spending,
                  onPress: () => router.push('/personal/spending'),
                },
                {
                  key: 'ask',
                  tint: 'mint',
                  icon: 'sparkles-outline',
                  label: t.spendingAsk.title,
                  onPress: () => router.push('/personal/ask'),
                },
                {
                  key: 'todo',
                  tint: 'peach',
                  icon: 'checkbox-outline',
                  label: h.toolTodo,
                  onPress: () => router.push('/personal/setup'),
                },
                {
                  key: 'more',
                  tint: 'lilac',
                  icon: 'ellipsis-horizontal',
                  label: h.toolMore,
                  onPress: () => setMoreOpen(true),
                },
              ]}
            />
          </Card>

          <PrivacyFooterPill />
        </View>
      </ScrollView>
      <OverflowMenu
        visible={switchOpen}
        onClose={() => setSwitchOpen(false)}
        items={[
          { icon: 'checkmark', label: h.space, onPress: () => undefined },
          { icon: 'people-outline', label: h.sharedSpace, onPress: () => switchTab('/') },
        ]}
      />
      <OverflowMenu visible={moreOpen} onClose={() => setMoreOpen(false)} items={moreItems} />
      <OverflowMenu
        visible={monthMenuOpen}
        onClose={() => setMonthMenuOpen(false)}
        items={monthItems}
      />
      <OverflowMenu
        visible={gearOpen}
        onClose={() => setGearOpen(false)}
        items={[
          { icon: 'sparkles-outline', label: t.personalSetup.title, route: '/personal/setup' },
          { icon: 'image-outline', label: t.heroScene.title, route: '/settings/scene' },
          { icon: 'lock-closed-outline', label: t.personal.dash.settings, route: '/settings/lock' },
        ]}
      />
      <PersonalIntro visible={introOpen} onDone={closeIntro} />
    </Screen>
  );
}

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
const HEADLINE_STYLE = { fontSize: 30, lineHeight: 36, fontWeight: '700' } as const;

/** How many months the faint bar chart behind the headline covers. */
const SPEND_HISTORY_MONTHS = 6;

/** The month on show, as a brand-coloured dropdown — a picker when there are
 *  other months to reach, and just the month's name when there are not. */
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
      hitSlop={8}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        maxWidth: 180,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text
        variant="caption"
        tone="brand"
        numberOfLines={1}
        style={{ flexShrink: 1, fontWeight: '700' }}
      >
        {label}
      </Text>
      {onPress ? (
        <Ionicons name="chevron-down" size={iconSize.sm} color={theme.color.brand} />
      ) : null}
    </Pressable>
  );
}

// ──────────────────────────────────────────────────────────────── body ──

/** One recent entry: its badge, what it was and when, and the amount. Opens the entry. */
function ExpenseRow({
  txn,
  title,
  categoryLabel,
  date,
  locale,
  hidden = false,
}: {
  txn: PersonalTxn;
  title: string;
  categoryLabel: string;
  date: string;
  locale: string;
  hidden?: boolean;
}) {
  const theme = useTheme();
  const expense = txn.kind === 'expense';
  const amount = hidden
    ? BALANCE_MASK
    : `${expense ? '−' : '+'}${format(money(txn.amount, txn.currency), { locale })}`;
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
      <Text
        variant="body"
        numberOfLines={1}
        style={{ fontWeight: '700', color: expense ? theme.color.negative : theme.color.positive }}
      >
        {amount}
      </Text>
    </Pressable>
  );
}

// A month as "Aug", under its bar.
function monthShort(month: string, locale: string): string {
  try {
    return dateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(
      new Date(`${month}-01T00:00:00Z`),
    );
  } catch {
    return month;
  }
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
/** A blank ledger opens the setup flow once per launch; backing out leaves the first-run screen. */
let setupOffered = false;
function OpenSetupOnce() {
  useEffect(() => {
    if (setupOffered) return;
    setupOffered = true;
    router.push('/personal/setup');
  }, []);
  return null;
}

function PersonalFirstRun({ t }: { t: ReturnType<typeof useStrings>['t'] }) {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  return (
    <Screen edges={[]}>
      <HeroShell wash={SAVED_WASH}>
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="title" tone="onBrand" numberOfLines={1}>
            {t.personal.nav.overview}
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
                label={t.personalSetup.title}
                variant="secondary"
                onPress={() => router.push('/personal/setup')}
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
        borderRadius: theme.radius.md,
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
        borderRadius: theme.radius.md,
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
