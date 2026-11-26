/**
 * Pure pieces of the Share-it group home ("Our November"): the month's spend
 * against the household budget, and how a shared bill names its date.
 */
import { frequencyOf, Frequency, type GroupRecurringRule } from '@waves/core';

/** Spend in `currency` for expenses dated in `monthKey` ("YYYY-MM"). Other currencies are not mixed in. */
export function monthSpend(
  expenses: readonly { date: string; amount: bigint; currency: string }[],
  monthKey: string,
  currency: string,
): bigint {
  let total = 0n;
  for (const e of expenses)
    if (e.currency === currency && e.date.slice(0, 7) === monthKey) total += e.amount;
  return total;
}

export interface MonthProgress {
  readonly hasBudget: boolean;
  /** 0..1, for the bar. */
  readonly fraction: number;
  /** Positive remaining; zero once over. */
  readonly left: bigint;
  /** How far past the budget, zero while within. */
  readonly over: bigint;
  readonly onTrack: boolean;
}

export function monthProgress(spent: bigint, budget: bigint | null): MonthProgress {
  if (budget === null || budget <= 0n)
    return { hasBudget: false, fraction: 0, left: 0n, over: 0n, onTrack: true };
  const over = spent > budget ? spent - budget : 0n;
  const fraction = spent >= budget ? 1 : Number((spent * 10000n) / budget) / 10000;
  return {
    hasBudget: true,
    fraction,
    left: over > 0n ? 0n : budget - spent,
    over,
    onTrack: over === 0n,
  };
}

export type BillWhen =
  | { kind: 'date'; date: string }
  | { kind: 'every'; every: 'week' | 'twoWeeks' | 'twiceMonth' | 'months' | 'year'; n: number };

/** "1 Dec" for a monthly bill; "every term" style wording for the rest. */
export function billWhen(
  rule: Pick<GroupRecurringRule, 'cadence' | 'interval' | 'nextDate'>,
): BillWhen {
  switch (frequencyOf({ cadence: rule.cadence, interval: rule.interval })) {
    case Frequency.Monthly:
      return { kind: 'date', date: rule.nextDate };
    case Frequency.Weekly:
      return { kind: 'every', every: 'week', n: 1 };
    case Frequency.Fortnightly:
      return { kind: 'every', every: 'twoWeeks', n: 2 };
    case Frequency.TwiceAMonth:
      return { kind: 'every', every: 'twiceMonth', n: 2 };
    case Frequency.Yearly:
      return { kind: 'every', every: 'year', n: 1 };
    case Frequency.Quarterly:
      return { kind: 'every', every: 'months', n: 3 };
    case Frequency.HalfYearly:
      return { kind: 'every', every: 'months', n: 6 };
    default:
      return { kind: 'every', every: 'months', n: Math.max(1, rule.interval) };
  }
}

/** The member who pays a shared bill: the largest payer, ties to the first listed. */
export function billPayer(payers: Readonly<Record<string, bigint>>): string | null {
  let best: string | null = null;
  let top = 0n;
  for (const [member, paid] of Object.entries(payers))
    if (paid > top) {
      top = paid;
      best = member;
    }
  return best;
}

/** An amount's text with a bare ".00" dropped (whole amounts); real minor units still show. */
export function compactAmount(parts: {
  text: string;
  lead: string;
  trail: string;
  fraction: string;
}): string {
  return /[1-9]/.test(parts.fraction) ? parts.text : parts.lead + parts.trail;
}

/** A headline tile only needs the short form (₹1.2L, $120K) from 100,000 major units up. */
export const needsCompactTile = (minor: bigint): boolean =>
  minor >= 10_000_000n || minor <= -10_000_000n;
