/**
 * The plan maths behind Personal's home ring, the "where you can save" card and
 * the weekly / monthly recaps. Pure and deterministic: dates come in as
 * YYYY-MM-DD strings, money as bigint minor units, nothing reads a clock.
 *
 * Wording rule (see spending.ts): the ledger says "left over", never "saved".
 */

import type { CurrencyCode } from '../money/currency';
import {
  categoryBreakdown,
  dayDelta,
  monthKey,
  monthOutlook,
  monthRange,
  monthlySummary,
  nextRecurring,
  personalBudgetProgress,
  recentMonths,
  worstOverBudget,
  type CategorySpend,
  type UpcomingRecurring,
} from './compute';
import { matchService } from './services/catalog';
import type { PersonalBudget, PersonalRecurring, PersonalTxn } from './types';

export interface PlanInput {
  readonly txns: readonly PersonalTxn[];
  readonly recurrings: readonly PersonalRecurring[];
  readonly budgets: readonly PersonalBudget[];
  readonly currency: CurrencyCode;
  /** Local today, YYYY-MM-DD. */
  readonly today: string;
}

// ───────────────────────────────────────────────────────────── dates ──

const DAY_MS = 86_400_000;
const toUtc = (date: string): number => {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
};
/** `date` moved by `n` whole days (negative goes back). */
export function addPlanDays(date: string, n: number): string {
  return new Date(toUtc(date) + n * DAY_MS).toISOString().slice(0, 10);
}
/** 0 = Monday … 6 = Sunday. */
const mondayIndex = (date: string): number => (new Date(toUtc(date)).getUTCDay() + 6) % 7;
/** The Monday of the week `date` falls in. */
export function weekStartOf(date: string): string {
  return addPlanDays(date, -mondayIndex(date));
}

function spentBetween(
  txns: readonly PersonalTxn[],
  currency: CurrencyCode,
  from: string,
  to: string,
): bigint {
  let sum = 0n;
  for (const t of txns) {
    if (t.kind === 'expense' && t.currency === currency && t.date >= from && t.date <= to) {
      sum += t.amount;
    }
  }
  return sum;
}

// ─────────────────────────────────────────────────── left today / week ──

export interface DayPlan {
  /** What a fair day looks like for the rest of the month (before today's spend). */
  readonly perDay: bigint;
  /** perDay minus what went out today. Negative means today ran over. */
  readonly leftToday: bigint;
  /** What the rest of this week may take, never more than the month has left. */
  readonly leftThisWeek: bigint;
  readonly daysLeft: number;
}

/**
 * (income expected this month − bills still to leave − spent so far), spread over
 * the days left (today included). Falls back to the overall monthly budget when
 * no income is known, and to null when there is neither.
 */
export function dayPlan(input: PlanInput): DayPlan | null {
  const { txns, recurrings, budgets, currency, today } = input;
  const month = monthKey(today);
  const range = monthRange(month);
  if (!range) return null;
  const outlook = monthOutlook(txns, recurrings, month, currency, today);

  let pool: bigint;
  if (outlook.income + outlook.expectedIncome > 0n) {
    pool = outlook.income + outlook.expectedIncome - outlook.expectedExpense - outlook.expense;
  } else {
    const cap = budgets.find((b) => b.category === null && b.currency === currency);
    if (!cap) return null;
    // The cap is for everyday spending; bills are not taken out of it twice.
    pool = personalBudgetProgress(cap, txns, month).remaining;
  }

  const daysLeft = dayDelta(today, range.to) + 1;
  const spentToday = spentBetween(txns, currency, today, today);
  const perDay = (pool + spentToday) / BigInt(daysLeft);
  const weekDaysLeft = Math.min(daysLeft, 7 - mondayIndex(today));
  const weekShare = perDay * BigInt(weekDaysLeft) - spentToday;
  return {
    perDay,
    leftToday: perDay - spentToday,
    leftThisWeek: weekShare < pool ? weekShare : pool,
    daysLeft,
  };
}

/** What is left to spend today, or null when there is nothing to plan from. */
export const leftToday = (input: PlanInput): bigint | null => dayPlan(input)?.leftToday ?? null;
/** What is left to spend this week (Mon–Sun), or null. */
export const leftThisWeek = (input: PlanInput): bigint | null =>
  dayPlan(input)?.leftThisWeek ?? null;

/** Budget remainder spread across the remaining calendar days, including today. */
export function budgetDailyPace(left: bigint | null, today: string): bigint | null {
  const range = monthRange(monthKey(today));
  if (left === null || left < 0n || !range) return null;
  return left / BigInt(dayDelta(today, range.to) + 1);
}

// ───────────────────────────────────────────────────────────── recaps ──

export interface WeekVsUsual {
  readonly spent: bigint;
  /** Average of the four weeks before. */
  readonly usual: bigint;
  /** spent − usual; positive means more than usual. */
  readonly delta: bigint;
}

/**
 * The week starting `weekStart` (a Monday) against the average of the four weeks
 * before it. Null when those weeks had no spend to compare with.
 */
export function weekVsUsual(
  txns: readonly PersonalTxn[],
  currency: CurrencyCode,
  weekStart: string,
): WeekVsUsual | null {
  const spent = spentBetween(txns, currency, weekStart, addPlanDays(weekStart, 6));
  const before = spentBetween(
    txns,
    currency,
    addPlanDays(weekStart, -28),
    addPlanDays(weekStart, -1),
  );
  if (before <= 0n) return null;
  const usual = before / 4n;
  return { spent, usual, delta: spent - usual };
}

export interface WeekRecap {
  readonly from: string;
  readonly to: string;
  readonly spent: bigint;
  readonly vsUsual: WeekVsUsual | null;
  readonly topCategory: CategorySpend | null;
  /** The soonest expense rule still ahead of the week. */
  readonly nextBill: UpcomingRecurring | null;
}

export function weekRecap(input: PlanInput, weekStart: string): WeekRecap {
  const { txns, recurrings, currency, today } = input;
  const to = addPlanDays(weekStart, 6);
  const inWeek = txns.filter((t) => t.date >= weekStart && t.date <= to);
  return {
    from: weekStart,
    to,
    spent: spentBetween(txns, currency, weekStart, to),
    vsUsual: weekVsUsual(txns, currency, weekStart),
    topCategory: categoryBreakdown(inWeek, monthKey(weekStart), currency)[0] ?? null,
    nextBill: nextRecurring(
      recurrings.filter((r) => r.txnKind === 'expense' && r.currency === currency),
      today,
    ),
  };
}

export interface MonthRecap {
  readonly month: string;
  readonly spent: bigint;
  readonly income: bigint;
  /** income − spent. */
  readonly leftOver: bigint;
  /** Against the last 3 months that had any activity; null with none to compare. */
  readonly rank: 'best' | 'worst' | null;
  /** How many months the ranking spans, this one included. */
  readonly rankMonths: number;
  readonly topCategory: CategorySpend | null;
  /** Spend for the 6 months ending at `month`, oldest first. */
  readonly trend: readonly { month: string; spent: bigint }[];
}

export function monthRecap(
  txns: readonly PersonalTxn[],
  month: string,
  currency: CurrencyCode,
): MonthRecap {
  const cur = monthlySummary(txns, month, currency);
  const prior = recentMonths(month, 4)
    .slice(0, -1)
    .map((m) => monthlySummary(txns, m, currency))
    .filter((s) => s.income > 0n || s.expense > 0n);
  const rank =
    prior.length === 0
      ? null
      : prior.every((s) => cur.net > s.net)
        ? 'best'
        : prior.every((s) => cur.net < s.net)
          ? 'worst'
          : null;
  return {
    month,
    spent: cur.expense,
    income: cur.income,
    leftOver: cur.net,
    rank,
    rankMonths: prior.length + 1,
    topCategory: categoryBreakdown(txns, month, currency)[0] ?? null,
    trend: recentMonths(month, 6).map((m) => ({
      month: m,
      spent: monthlySummary(txns, m, currency).expense,
    })),
  };
}

export interface RecapTarget {
  readonly kind: 'week' | 'month';
  /** Stable id of the thing being recapped: the week's Monday, or the YYYY-MM. */
  readonly key: string;
}

/**
 * Which recap, if any, is on offer at this local moment: the month's on the
 * 1st–3rd (recapping the month just ended), else the week's from Sunday 18:00
 * through Tuesday (recapping the week ending that Sunday).
 */
export function recapTarget(today: string, hour: number): RecapTarget | null {
  if (Number(today.slice(8, 10)) <= 3)
    return { kind: 'month', key: recentMonths(monthKey(today), 2)[0]! };
  const idx = mondayIndex(today);
  if (idx === 6 && hour >= 18) return { kind: 'week', key: weekStartOf(today) };
  if (idx <= 1) return { kind: 'week', key: addPlanDays(weekStartOf(today), -7) };
  return null;
}

// ───────────────────────────────────────────────────────────── tips ──

export type SaveTipKind = 'overMedian' | 'subscriptions' | 'overBudget';

export interface SaveTip {
  readonly kind: SaveTipKind;
  /** overMedian: the amount over the usual; subscriptions: the yearly total;
   *  overBudget: how far past the cap. */
  readonly amount: bigint;
  /** The category the tip is about; null for subscriptions / an overall cap. */
  readonly category: string | null;
  /** i18n key under personalPlan.tip. */
  readonly messageKey: SaveTipKind;
  readonly params: {
    readonly amount: bigint;
    readonly category: string | null;
    readonly count?: number;
    /** The category's usual monthly spend, to pre-fill a limit with. */
    readonly usual?: bigint;
  };
  /** Monthly weight, for ranking only. */
  readonly monthly: bigint;
}

/** Payments per year × 1 for one rule, as a yearly amount. */
function yearlyAmount(rule: PersonalRecurring): bigint {
  const n = BigInt(Math.max(1, rule.interval));
  switch (rule.cadence) {
    case 'weekly':
      return (rule.amount * 52n) / n;
    case 'semimonthly':
      return rule.amount * 24n;
    case 'monthly':
      return (rule.amount * 12n) / n;
    default:
      return rule.amount / n;
  }
}

const isSubscription = (rule: PersonalRecurring): boolean =>
  rule.txnKind === 'expense' &&
  (matchService(rule.note ?? '')?.kind === 'subscription' || rule.category === 'subscriptions');

function median3(values: readonly bigint[]): bigint {
  return [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[1] ?? 0n;
}

/** Up to three tips, one per kind, biggest monthly effect first. */
export function saveTips(input: PlanInput): SaveTip[] {
  const { txns, recurrings, budgets, currency, today } = input;
  const month = monthKey(today);
  const tips: SaveTip[] = [];

  // A category this month above the middle of its last three months.
  const [m1, m2, m3] = recentMonths(month, 4).slice(0, 3) as [string, string, string];
  const past = [m1, m2, m3].map((m) => categoryBreakdown(txns, m, currency));
  let best: { category: string | null; over: bigint; usual: bigint } | null = null;
  for (const row of categoryBreakdown(txns, month, currency)) {
    if (row.category === null) continue;
    const usual = median3(
      past.map((rows) => rows.find((r) => r.category === row.category)?.spent ?? 0n),
    );
    const over = row.spent - usual;
    // A quarter above usual, so rounding noise is not advice.
    if (usual > 0n && over * 4n >= usual && (best === null || over > best.over)) {
      best = { category: row.category, over, usual };
    }
  }
  if (best) {
    tips.push({
      kind: 'overMedian',
      amount: best.over,
      category: best.category,
      messageKey: 'overMedian',
      params: { amount: best.over, category: best.category, usual: best.usual },
      monthly: best.over,
    });
  }

  const subs = recurrings.filter(
    (r) => r.active && r.currency === currency && !r.investmentId && isSubscription(r),
  );
  const yearly = subs.reduce((sum, r) => sum + yearlyAmount(r), 0n);
  if (yearly > 0n) {
    tips.push({
      kind: 'subscriptions',
      amount: yearly,
      category: null,
      messageKey: 'subscriptions',
      params: { amount: yearly, category: null, count: subs.length },
      monthly: yearly / 12n,
    });
  }

  const over = worstOverBudget(budgets, txns, month, currency);
  if (over) {
    tips.push({
      kind: 'overBudget',
      amount: over.over,
      category: over.budget.category,
      messageKey: 'overBudget',
      params: { amount: over.over, category: over.budget.category },
      monthly: over.over,
    });
  }

  return tips.sort((a, b) => (b.monthly > a.monthly ? 1 : b.monthly < a.monthly ? -1 : 0));
}

// ─────────────────────────────────────────────────────────── cushion ──

/**
 * How many months of essentials the savings would cover: savings ÷ (active
 * expense rules per month + average everyday spend over the last 3 months).
 * One decimal. Null when savings is unknown or there is no spend to measure.
 */
export function cushionMonths(
  savings: bigint | null,
  input: Pick<PlanInput, 'txns' | 'recurrings' | 'currency' | 'today'>,
): number | null {
  if (savings === null) return null;
  const { txns, recurrings, currency, today } = input;
  const bills = recurrings
    .filter((r) => r.active && r.txnKind === 'expense' && r.currency === currency)
    .reduce((sum, r) => sum + yearlyAmount(r) / 12n, 0n);
  const months = recentMonths(monthKey(today), 4).slice(0, 3);
  let everyday = 0n;
  for (const t of txns) {
    if (
      t.kind === 'expense' &&
      t.currency === currency &&
      t.recurringId === null &&
      t.loanId === null &&
      months.includes(monthKey(t.date))
    ) {
      everyday += t.amount;
    }
  }
  const essentials = bills + everyday / BigInt(months.length);
  return essentials > 0n ? Number((savings * 10n) / essentials) / 10 : null;
}
