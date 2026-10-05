/**
 * "Upcoming payments" (docs/event-organizer.md): the vendor deposits still
 * owing a balance, across one group's expenses — soonest due first, overdue
 * ones first of all.
 *
 * Pure and React-Native-free, so it is tested directly
 * (test/upcomingPayments.test.ts). `today` is a parameter rather than read
 * from the clock in here, the same reason `todayIn` on the plan screen takes
 * a time zone instead of calling `new Date()` itself — a test gets to say
 * what day it is, and a screen gets to say which day ("the trip's", "the
 * phone's") without this module caring.
 */

/** One expense's deposit-tracking fields, trimmed to what this needs. */
export interface DepositCandidate {
  readonly expenseId: string;
  readonly description: string;
  readonly currency: string;
  readonly isDeposit: boolean;
  /** Minor units still owed. Ignored (never an upcoming payment) when null,
   *  zero or negative — a deposit with nothing left to pay is not a reminder. */
  readonly balanceDueMinor: bigint | null;
  /** ISO day (YYYY-MM-DD), or null for "due, whenever". */
  readonly balanceDueDate: string | null;
}

/** One row the "Upcoming payments" card shows. */
export interface UpcomingPayment {
  readonly expenseId: string;
  readonly description: string;
  readonly currency: string;
  readonly balanceDueMinor: bigint;
  readonly balanceDueDate: string | null;
  /** True once `balanceDueDate` is strictly before `today`. A date-less
   *  balance is never overdue — there is nothing to have missed. */
  readonly overdue: boolean;
}

/** A balance is overdue once its due date is strictly before `today`; one with
 *  no date is never overdue. Shared with the Vendors tab (lib/eventVendors). */
export function isBalanceOverdue(balanceDueDate: string | null, today: string): boolean {
  return balanceDueDate !== null && balanceDueDate < today;
}

/**
 * The deposits still owing, soonest due first; overdue ones first of all
 * (by how overdue, oldest first — the one that has waited longest wants
 * attention first); a balance with no due date sorts last, after every dated
 * one, and ties within a group break on description so the order is stable.
 */
export function upcomingPayments(
  candidates: readonly DepositCandidate[],
  today: string,
): readonly UpcomingPayment[] {
  const rows: UpcomingPayment[] = candidates
    .filter(
      (candidate): candidate is DepositCandidate & { balanceDueMinor: bigint } =>
        candidate.isDeposit && candidate.balanceDueMinor != null && candidate.balanceDueMinor > 0n,
    )
    .map((candidate) => ({
      expenseId: candidate.expenseId,
      description: candidate.description,
      currency: candidate.currency.toUpperCase(),
      balanceDueMinor: candidate.balanceDueMinor,
      balanceDueDate: candidate.balanceDueDate,
      overdue: isBalanceOverdue(candidate.balanceDueDate, today),
    }));

  return rows.sort((a, b) => {
    if (a.balanceDueDate === null && b.balanceDueDate === null) {
      return a.description.localeCompare(b.description);
    }
    if (a.balanceDueDate === null) return 1;
    if (b.balanceDueDate === null) return -1;
    if (a.balanceDueDate !== b.balanceDueDate) {
      return a.balanceDueDate < b.balanceDueDate ? -1 : 1;
    }
    return a.description.localeCompare(b.description);
  });
}

/** How many rows {@link upcomingPayments} returned are overdue — the count an
 *  "Upcoming payments" card's badge wants without re-deriving it. */
export function overdueCount(payments: readonly UpcomingPayment[]): number {
  return payments.reduce((count, payment) => count + (payment.overdue ? 1 : 0), 0);
}
