/**
 * What the Personal home's "Upcoming & Reminders" card lists: bills the
 * recurring rules expect soon, the Upcoming dates, and the setup to-do, merged
 * by date. Pure, so the merge and its limits are testable.
 */

import {
  addPlanDays,
  occurrences,
  type PersonalRecurring,
  type PersonalTxn,
  type UpcomingItem,
} from '@waves/core';

export type RowTone = 'brand' | 'positive' | 'negative' | 'warning';

export interface UpcomingRow {
  readonly key: string;
  readonly kind: 'bill' | 'date' | 'todo';
  readonly tone: RowTone;
  /** Days from today (negative once overdue); the to-do has none and sorts last. */
  readonly inDays: number;
  readonly date: string | null;
  readonly ruleId?: string;
  readonly title?: string;
  readonly category?: string | null;
  readonly amount?: bigint;
  readonly currency?: string;
  readonly item?: UpcomingItem;
  /** To-do only: how many setup questions are still open. */
  readonly left?: number;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
}

/** Expense rules' next occurrences inside the horizon, plus this month's overdue ones. */
export function billRows(
  txns: readonly PersonalTxn[],
  recurrings: readonly PersonalRecurring[],
  currency: string,
  today: string,
  horizonDays: number,
): UpcomingRow[] {
  const range = { from: `${today.slice(0, 7)}-01`, to: addPlanDays(today, horizonDays) };
  const out: UpcomingRow[] = [];
  for (const rule of recurrings) {
    if (!rule.active || rule.currency !== currency || rule.txnKind !== 'expense') continue;
    for (const o of occurrences(rule, txns, range, today)) {
      if (o.status === 'received') continue;
      out.push({
        key: `${rule.id}:${o.periodKey}`,
        kind: 'bill',
        tone: 'brand',
        inDays: daysBetween(today, o.dueDate),
        date: o.dueDate,
        ruleId: rule.id,
        title: rule.note?.trim() ?? '',
        category: rule.category,
        amount: o.expected,
        currency: rule.currency,
      });
    }
  }
  return out;
}

export function dateRows(items: readonly UpcomingItem[]): UpcomingRow[] {
  return items.map((item) => ({
    key: item.key,
    kind: 'date',
    tone:
      item.source === 'festival'
        ? 'positive'
        : item.kind === 'family_birthday' || item.kind === 'my_birthday'
          ? 'negative'
          : item.kind === 'work_anniversary'
            ? 'warning'
            : 'brand',
    inDays: item.inDays,
    date: item.date,
    item,
  }));
}

/**
 * Sorted by date; the to-do (when setup is unfinished) always keeps a seat and
 * sits last. A `limit` of 0 means no limit.
 */
export function mergeUpcoming(
  dated: readonly UpcomingRow[],
  todoLeft: number,
  limit: number,
): UpcomingRow[] {
  const sorted = [...dated].sort((a, b) => a.inDays - b.inDays || (a.key < b.key ? -1 : 1));
  const todo: UpcomingRow[] =
    todoLeft > 0
      ? [
          {
            key: 'todo',
            kind: 'todo',
            tone: 'warning',
            inDays: Infinity,
            date: null,
            left: todoLeft,
          },
        ]
      : [];
  return limit > 0 ? [...sorted.slice(0, limit - todo.length), ...todo] : [...sorted, ...todo];
}

/** The bell's dot: something is due today, overdue, or tomorrow. */
export const hasDue = (rows: readonly UpcomingRow[]): boolean =>
  rows.some((r) => r.kind !== 'todo' && r.inDays <= 1);
