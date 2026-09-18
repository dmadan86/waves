/**
 * The plan and the ledger, in the shape `buildTimeline` reads.
 *
 * Two conversions, both of them places a screen goes quietly wrong:
 *
 * - **`done` is `done_at !== null`**, not a boolean column. Reading it as one
 *   makes every item look unticked forever, and the tick still appears to work
 *   because the write succeeds — it is only the next load that forgets.
 * - **`starts_at` arrives as `'HH:MM:SS'`** and is shown as `'HH:MM'`. Left
 *   whole it sorts the same but reads like a timestamp in a plan.
 *
 * Both maps drop what has no business on a timeline: a deleted expense, or one
 * with no current version. The plan's own tombstones never arrive — the read
 * asks for live rows.
 */

import type { PlanItem, TimelineExpense } from '@waves/core';

/** The half of an expense a timeline needs. */
export interface TimelineSource {
  readonly id: string;
  readonly deleted_at?: string | null;
  readonly currentVersion: {
    readonly description: string;
    readonly category: string | null;
    /** 'YYYY-MM-DD'. */
    readonly expense_date: string;
    readonly amount: string;
    readonly currency: string;
  } | null;
}

/** The half of a plan row this reads. */
export interface PlanSource {
  readonly id: string;
  readonly day: string;
  readonly starts_at: string | null;
  readonly title: string;
  readonly note: string | null;
  readonly category: string | null;
  readonly planned_minor: string | null;
  readonly currency: string;
  readonly done_at: string | null;
  readonly expense_id: string | null;
  readonly position: number;
}

export function planItems(rows: readonly PlanSource[]): PlanItem[] {
  return rows.map((row) => ({
    id: row.id,
    day: row.day.slice(0, 10),
    // 'HH:MM:SS' → 'HH:MM'. A plan says "09:30", not "09:30:00".
    startsAt: row.starts_at ? row.starts_at.slice(0, 5) : null,
    title: row.title,
    note: row.note,
    category: row.category,
    plannedMinor: row.planned_minor === null ? null : BigInt(row.planned_minor),
    currency: row.currency,
    // Ticked off is a timestamp on the row, not a flag.
    done: row.done_at !== null,
    expenseId: row.expense_id,
    position: row.position,
  }));
}

export function timelineExpenses(expenses: readonly TimelineSource[]): TimelineExpense[] {
  const out: TimelineExpense[] = [];
  for (const expense of expenses) {
    const version = expense.currentVersion;
    if (!version || expense.deleted_at) continue;
    out.push({
      id: expense.id,
      date: version.expense_date.slice(0, 10),
      description: version.description,
      category: version.category,
      amountMinor: BigInt(version.amount),
      currency: version.currency,
    });
  }
  return out;
}

/**
 * Today where the trip is, not where the reader is.
 *
 * Which day a trip is on is a question about the trip. Somebody reading their
 * Goa itinerary from London at 11pm is still on the same day of the trip as
 * everybody else, and `dayNumber` compares date strings — so the string has to
 * be built in the trip's zone or the highlight lands on the wrong row.
 */
export function todayIn(timeZone: string): string {
  try {
    // 'en-CA' formats as YYYY-MM-DD, which is the shape the ledger stores.
    return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
  } catch {
    // An unknown zone throws rather than falling back, and a planner that
    // cannot name today is still a planner.
    return new Date().toISOString().slice(0, 10);
  }
}

/** An expense reduced to who paid and who owes, for the fairness read. */
export interface ContributionSource {
  readonly deleted_at?: string | null;
  readonly currentVersion: {
    readonly currency: string;
    readonly payers: readonly { readonly member_id: string; readonly amount: string }[];
    readonly shares: readonly { readonly member_id: string; readonly amount: string }[];
  } | null;
}

/**
 * Who fronted what, and who owed what, per member per currency.
 *
 * The two halves come from different columns and mean different things: paid is
 * the payers, owed is the shares. Fairness is the difference between them, so
 * reading either one twice would make every trip look perfectly balanced —
 * which is exactly the answer nobody would question.
 */
export function contributions(
  expenses: readonly ContributionSource[],
): { member: string; currency: string; paidMinor: bigint; owedMinor: bigint }[] {
  const byKey = new Map<
    string,
    { member: string; currency: string; paidMinor: bigint; owedMinor: bigint }
  >();
  const touch = (member: string, currency: string) => {
    const key = `${member}|${currency}`;
    let row = byKey.get(key);
    if (!row) {
      row = { member, currency, paidMinor: 0n, owedMinor: 0n };
      byKey.set(key, row);
    }
    return row;
  };

  for (const expense of expenses) {
    const version = expense.currentVersion;
    if (!version || expense.deleted_at) continue;
    for (const payer of version.payers) {
      touch(payer.member_id, version.currency).paidMinor += BigInt(payer.amount);
    }
    for (const share of version.shares) {
      touch(share.member_id, version.currency).owedMinor += BigInt(share.amount);
    }
  }
  return [...byKey.values()];
}

/** An expense reduced to the shares a personal budget is a ceiling on. */
export interface ShareSource {
  readonly deleted_at?: string | null;
  readonly currentVersion: {
    readonly currency: string;
    readonly shares: readonly { readonly member_id: string; readonly amount: string }[];
  } | null;
}

/**
 * The live expenses in the shape `spendByMember` reads.
 *
 * Shares, not payers: a personal budget caps what somebody's trip *cost them*,
 * not what passed through their hands. Fronting the hotel and being repaid the
 * next day does not spend anybody's budget.
 */
export function sharedExpenses(
  expenses: readonly ShareSource[],
): { currency: string; shares: Record<string, bigint> }[] {
  const out: { currency: string; shares: Record<string, bigint> }[] = [];
  for (const expense of expenses) {
    const version = expense.currentVersion;
    if (!version || expense.deleted_at) continue;
    const shares: Record<string, bigint> = {};
    for (const share of version.shares) {
      shares[share.member_id] = (shares[share.member_id] ?? 0n) + BigInt(share.amount);
    }
    out.push({ currency: version.currency, shares });
  }
  return out;
}
