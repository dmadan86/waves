/** The Today week strip: seven days, each ring = that day's spend against the daily budget pace. */

import { monthlySpendEntries, type CurrencyCode, type PersonalTxn } from '@waves/core';

const DAY_MS = 864e5;
const toUtc = (d: string): number => Date.parse(`${d}T00:00:00Z`);
export const addDays = (d: string, n: number): string =>
  new Date(toUtc(d) + n * DAY_MS).toISOString().slice(0, 10);

/** Days in a YYYY-MM month. */
export const daysInMonth = (month: string): number =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

/** The first day of the week containing `today`; `weekStart` is 0 (Sunday) … 6 (Saturday). */
export function weekStartDate(today: string, weekStart: number): string {
  const dow = new Date(toUtc(today)).getUTCDay();
  return addDays(today, -((dow - weekStart + 7) % 7));
}

/** One day's budget: the monthly cap spread evenly over its days. Null without a budget. */
export function dailyPace(monthlyLimit: bigint | null, month: string): bigint | null {
  return monthlyLimit && monthlyLimit > 0n ? monthlyLimit / BigInt(daysInMonth(month)) : null;
}

/** What was spent on each date in [from, to] (everyday spending, the same figure Home uses). */
export function spendByDate(
  txns: readonly PersonalTxn[],
  currency: CurrencyCode,
  from: string,
  to: string,
): Record<string, bigint> {
  const out: Record<string, bigint> = {};
  const months = new Set([from.slice(0, 7), to.slice(0, 7)]);
  for (const m of months) {
    for (const e of monthlySpendEntries(txns, m, currency)) {
      if (e.date >= from && e.date <= to) out[e.date] = (out[e.date] ?? 0n) + e.amount;
    }
  }
  return out;
}

export interface WeekDay {
  readonly date: string;
  /** 0 = Sunday … 6 = Saturday, for the letter above the ring. */
  readonly weekday: number;
  readonly state: 'past' | 'today' | 'future';
  readonly spent: bigint;
  /** 0–1 of the ring filled. */
  readonly fill: number;
  /** Spent more than that day's pace: the ring turns amber. */
  readonly over: boolean;
  /** A bill falls due on this day. */
  readonly due: boolean;
}

export function weekDays(input: {
  today: string;
  weekStart: number;
  spent: Readonly<Record<string, bigint>>;
  pace: bigint | null;
  dueDates: ReadonlySet<string>;
}): WeekDay[] {
  const first = weekStartDate(input.today, input.weekStart);
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(first, i);
    const state = date < input.today ? 'past' : date === input.today ? 'today' : 'future';
    const spent = state === 'future' ? 0n : (input.spent[date] ?? 0n);
    const over = input.pace !== null && spent > input.pace;
    const fill =
      spent === 0n
        ? 0
        : input.pace === null
          ? 1
          : Math.min(1, Number((spent * 1000n) / input.pace) / 1000);
    return {
      date,
      weekday: new Date(toUtc(date)).getUTCDay(),
      state,
      spent,
      fill,
      over,
      due: input.dueDates.has(date),
    };
  });
}

/** The week's spend so far and, with a budget, whether it is inside the pace. */
export function weekSummary(
  days: readonly WeekDay[],
  pace: bigint | null,
): { spent: bigint; verdict: 'onTrack' | 'overPace' | null } {
  const elapsed = days.filter((d) => d.state !== 'future');
  const spent = elapsed.reduce((s, d) => s + d.spent, 0n);
  if (pace === null) return { spent, verdict: null };
  return { spent, verdict: spent > pace * BigInt(elapsed.length) ? 'overPace' : 'onTrack' };
}
