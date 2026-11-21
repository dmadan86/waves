/**
 * Which "plan" notifications Personal should have on this phone over the next
 * week. Pure: `now` and the ledger come in, a list of what to schedule comes
 * out. Same shape as `captureNudge/plan.ts`, and for the same reason — every
 * rule here is a sentence about somebody's attention, so it is testable.
 *
 * Kinds: a bill the evening before it goes out, a weekly recap (Sunday), a
 * monthly recap (the 1st), and an opt-in "left today" note.
 *
 * Rules: at most one a day (bill > month > week > daily); at most three a week
 * (one recap + two bills; the opt-in daily is exempt); only 08:00-21:00 local;
 * never for nothing; only the next 7 days (iOS holds 64 pending alarms).
 * Three delivered-but-unopened in a row falls back to the recaps only.
 */

import {
  addPlanDays,
  dayPlan,
  monthRecap,
  recentMonths,
  stepOccurrence,
  weekRecap,
  weekStartOf,
  type CurrencyCode,
  type PersonalBudget,
  type PersonalRecurring,
  type PersonalTxn,
} from '@waves/core';

export type PlanKind = 'bill' | 'week' | 'month' | 'daily';

export interface PlanPrefs {
  readonly bills: boolean;
  readonly recap: boolean;
  readonly daily: boolean;
}

export const DEFAULT_PLAN_PREFS: PlanPrefs = { bills: true, recap: true, daily: false };

/** Local hours each kind goes out at; all inside the 08:00-21:00 window. */
export const PLAN_HOURS: Readonly<Record<PlanKind, number>> = {
  bill: 19,
  week: 19,
  month: 10,
  daily: 9,
};
const HORIZON_MS = 7 * 86_400_000;
const MAX_BILLS_PER_WEEK = 2;
const UNOPENED_LIMIT = 3;

interface Common {
  /** Identity of this exact notification and its text; equal id = nothing to redo. */
  readonly id: string;
  readonly fireAt: number;
  readonly url: string;
}
export type PlanItem = Common &
  (
    | {
        readonly kind: 'bill';
        readonly amount: bigint;
        readonly label: string | null;
        readonly category: string | null;
        readonly covered: boolean;
      }
    | { readonly kind: 'week'; readonly spent: bigint; readonly delta: bigint | null }
    | { readonly kind: 'month'; readonly month: string; readonly leftOver: bigint }
    | { readonly kind: 'daily'; readonly amount: bigint }
  );

export interface PlanHistory {
  /** Fire times of plan notifications this phone scheduled. */
  readonly scheduled: readonly number[];
  /** Fire times of the ones somebody tapped. */
  readonly opened: readonly number[];
}

export interface PlanNudgeInput {
  readonly now: number;
  readonly txns: readonly PersonalTxn[];
  readonly recurrings: readonly PersonalRecurring[];
  readonly budgets: readonly PersonalBudget[];
  readonly currency: CurrencyCode;
  readonly prefs: PlanPrefs;
  readonly history: PlanHistory;
  /** Language + amounts-hidden, baked into the id because both change the text. */
  readonly textKey: string;
}

export function localIso(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function atHour(date: string, hour: number): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y!, m! - 1, d!, hour).getTime();
}

/** True when the last three notifications that must have gone off were all ignored. */
export function lastThreeUnopened(history: PlanHistory, now: number): boolean {
  const delivered = history.scheduled
    .filter((at) => at <= now)
    .sort((a, b) => b - a)
    .slice(0, UNOPENED_LIMIT);
  return (
    delivered.length === UNOPENED_LIMIT && delivered.every((at) => !history.opened.includes(at))
  );
}

const PRIORITY: Record<PlanKind, number> = { bill: 0, month: 1, week: 2, daily: 3 };

export function planNudges(input: PlanNudgeInput): PlanItem[] {
  const { now, txns, recurrings, budgets, currency, prefs, textKey } = input;
  const today = localIso(now);
  const base = { txns, recurrings, budgets, currency, today };
  const limit = now + HORIZON_MS;
  const cands: { date: string; item: PlanItem }[] = [];
  const add = (date: string, kind: PlanKind, detail: string, extra: object): void => {
    const fireAt = atHour(date, PLAN_HOURS[kind]);
    if (fireAt <= now || fireAt > limit) return;
    const url =
      kind === 'bill'
        ? 'waves://personal/recurring'
        : kind === 'daily'
          ? 'waves://me'
          : `waves://personal/recap?kind=${kind}`;
    const id = `${kind}|${fireAt}|${detail}|${textKey}`;
    cands.push({ date, item: { kind, id, fireAt, url, ...extra } as PlanItem });
  };

  if (prefs.bills) {
    // shortcut: "covered" reads this month's pool even for a bill next month.
    const dp = dayPlan(base);
    const covered = dp !== null && dp.perDay * BigInt(dp.daysLeft) >= 0n;
    const last = addPlanDays(today, 8);
    for (const rule of recurrings) {
      if (!rule.active || rule.txnKind !== 'expense' || rule.currency !== currency) continue;
      let due = rule.nextDate;
      for (let i = 0; i < 500 && due <= last; i += 1) {
        if (due > today && (rule.endDate === null || due <= rule.endDate)) {
          add(addPlanDays(due, -1), 'bill', `${rule.id}|${rule.amount}|${rule.note}|${covered}`, {
            amount: rule.amount,
            label: rule.note,
            category: rule.category,
            covered,
          });
        }
        const next = stepOccurrence(rule, due);
        if (next <= due) break;
        due = next;
      }
    }
  }

  if (prefs.recap) {
    for (let d = 0; d <= 8; d += 1) {
      const date = addPlanDays(today, d);
      if (new Date(`${date}T00:00:00Z`).getUTCDay() === 0) {
        const r = weekRecap(base, weekStartOf(date));
        if (r.spent > 0n) {
          const delta = r.vsUsual && r.vsUsual.delta !== 0n ? r.vsUsual.delta : null;
          add(date, 'week', `${r.spent}|${delta}`, { spent: r.spent, delta });
        }
      }
      if (date.endsWith('-01')) {
        const month = recentMonths(date.slice(0, 7), 2)[0]!;
        const r = monthRecap(txns, month, currency);
        if (r.spent > 0n || r.income > 0n) {
          add(date, 'month', `${month}|${r.leftOver}`, { month, leftOver: r.leftOver });
        }
      }
    }
  }

  if (prefs.daily) {
    // Only the next one: the figure is stale the moment anything is spent.
    const date = now < atHour(today, PLAN_HOURS.daily) ? today : addPlanDays(today, 1);
    const dp = dayPlan({ ...base, today: date });
    if (dp && dp.leftToday > 0n) add(date, 'daily', `${dp.leftToday}`, { amount: dp.leftToday });
  }

  const recapsOnly = lastThreeUnopened(input.history, now);
  const taken = new Set<string>();
  const weeks = new Map<string, { bills: number; recaps: number }>();
  const kept: PlanItem[] = [];
  const sorted = [...cands].sort(
    (a, b) => PRIORITY[a.item.kind] - PRIORITY[b.item.kind] || a.item.fireAt - b.item.fireAt,
  );
  for (const { date, item } of sorted) {
    if (taken.has(date)) continue;
    if (recapsOnly && item.kind !== 'week' && item.kind !== 'month') continue;
    if (item.kind !== 'daily') {
      const wk = weekStartOf(date);
      const n = weeks.get(wk) ?? { bills: 0, recaps: 0 };
      if (item.kind === 'bill' ? n.bills >= MAX_BILLS_PER_WEEK : n.recaps >= 1) continue;
      if (item.kind === 'bill') n.bills += 1;
      else n.recaps += 1;
      weeks.set(wk, n);
    }
    taken.add(date);
    kept.push(item);
  }
  return kept.sort((a, b) => a.fireAt - b.fireAt);
}
