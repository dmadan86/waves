/**
 * What the two trip screens read out of the ledger.
 *
 * Neither screen calculates anything — `recap` in `@waves/core` does the
 * arithmetic, and Places only lists. What they both do is *select*, and that is
 * the part that goes quietly wrong:
 *
 * - a deleted expense is not part of the trip, and a recap that still counts it
 *   reports a total nobody can reconcile against the ledger they are looking at;
 * - a recap's "fronted the most" is about **payers**, not shares. The two
 *   fields sit side by side on a version and sum to the same amount, so reading
 *   the wrong one produces a plausible name and a plausible figure — the worst
 *   kind of wrong, because nothing about the screen looks broken.
 *
 * So the selection lives here, where it can be tested, rather than inside a
 * component where it can only be read.
 */

import type { RecapExpense, ExpenseLocation } from '@waves/core';

/** The half of an expense these reads need. */
export interface TripExpense {
  readonly id: string;
  readonly deleted_at?: string | null;
  readonly currentVersion: {
    readonly description: string;
    readonly category: string | null;
    /** 'YYYY-MM-DD'. */
    readonly expense_date: string;
    readonly amount: string;
    readonly currency: string;
    readonly location?: ExpenseLocation | null;
    readonly payers: readonly { readonly member_id: string; readonly amount: string }[];
  } | null;
}

/** One place money was spent, as the list shows it. */
export interface Place {
  readonly id: string;
  readonly description: string;
  readonly location: ExpenseLocation;
  readonly amountMinor: bigint;
  readonly currency: string;
  /** 'YYYY-MM-DD'. */
  readonly day: string;
}

/**
 * The live expenses, in the shape `recap` reads.
 *
 * Payers, not shares: the recap's question is who put the money in.
 */
export function recapExpenses(expenses: readonly TripExpense[]): RecapExpense[] {
  const rows: RecapExpense[] = [];
  for (const expense of expenses) {
    const version = expense.currentVersion;
    if (!version || expense.deleted_at) continue;
    rows.push({
      id: expense.id,
      date: version.expense_date.slice(0, 10),
      description: version.description,
      category: version.category,
      amountMinor: BigInt(version.amount),
      currency: version.currency,
      payers: version.payers.map((payer) => ({
        member: payer.member_id,
        amountMinor: BigInt(payer.amount),
      })),
    });
  }
  return rows;
}

/**
 * Every live expense that carries a location, newest day first — the way the
 * ledger itself reads.
 *
 * The day is compared as the string the ledger stored rather than as a parsed
 * date, so no reader's timezone can reorder two days.
 */
export function placesOf(expenses: readonly TripExpense[]): Place[] {
  const out: Place[] = [];
  for (const expense of expenses) {
    const version = expense.currentVersion;
    if (!version || expense.deleted_at || !version.location) continue;
    out.push({
      id: expense.id,
      description: version.description,
      location: version.location,
      amountMinor: BigInt(version.amount),
      currency: version.currency,
      day: version.expense_date.slice(0, 10),
    });
  }
  return out.sort((a, b) => b.day.localeCompare(a.day));
}
