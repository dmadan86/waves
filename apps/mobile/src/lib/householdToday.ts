/** Pure pieces of the Family Home's Today layout (week spend, "Needs you", budget nudge). */

import type { HouseholdUpcoming } from '@waves/core';

import { daysInMonth } from '@/lib/calm/weekPace';

/** What was spent on each date in [from, to], in one currency. */
export function spendByDateRows(
  rows: readonly { date: string; amount: bigint; currency: string }[],
  currency: string,
  from: string,
  to: string,
): Record<string, bigint> {
  const out: Record<string, bigint> = {};
  for (const r of rows)
    if (r.currency === currency && r.date >= from && r.date <= to)
      out[r.date] = (out[r.date] ?? 0n) + r.amount;
  return out;
}

export type HouseholdNeed =
  ({ kind: 'bill' } & HouseholdUpcoming) | { kind: 'settle'; key: 'settle' };

/** Bills due today or overdue (overdue first), then the settle-up when balances are open. */
export function householdNeeds(input: {
  upcoming: readonly HouseholdUpcoming[];
  settled: boolean;
}): HouseholdNeed[] {
  const bills = input.upcoming
    .filter((r) => r.kind === 'bill' && r.inDays <= 0)
    .sort((a, b) => a.inDays - b.inDays)
    .map((r) => r as HouseholdNeed);
  return input.settled ? bills : [...bills, { kind: 'settle', key: 'settle' }];
}

/** The space's budget line, from 90% used on (the same threshold as Personal's nudge). */
export function householdBudgetNudge(
  budget: bigint | null,
  spent: bigint,
  today: string,
): { percent: number; remaining: bigint; daysLeft: number } | null {
  if (budget === null || budget <= 0n || spent * 10n < budget * 9n) return null;
  return {
    percent: Math.round(Number((spent * 10000n) / budget) / 100),
    remaining: budget - spent,
    daysLeft: daysInMonth(today.slice(0, 7)) - Number(today.slice(8, 10)),
  };
}
