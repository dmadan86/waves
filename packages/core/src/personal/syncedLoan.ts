/**
 * A loan shared with the other person.
 *
 * "Ravi owes me ₹5,000" used to live only in the lender's encrypted personal
 * blob, so Ravi never saw it and nothing could settle it. A *synced* loan keeps
 * that personal record but also books the debt where every other two-person debt
 * already lives: one expense in a one-to-one group between the two of you, paid
 * 100% by the lender with the whole amount as the borrower's share. Balances,
 * reminders, the Friends list and the settle-up / UPI flow then work unchanged —
 * a repayment is an ordinary settlement in that group.
 *
 * The personal loan and the expense are linked by ids (`SyncedLoanLink`), so:
 *  - the personal loan is a *view* of the debt, never a second copy of the money:
 *    its outstanding amount is read off the group balance, not off personal
 *    repayment txns;
 *  - the expense is recognisable (`syncedExpenseIds`) so a spending view that
 *    reads group shares can leave it out — lending is not spending;
 *  - undo and unlink know exactly which expense to remove.
 *
 * Everything here is pure: the screens hand in facts and draw what comes back.
 */

import type { PersonalLoan, PersonalTxn, SyncedLoanLink } from './types';

export const MAX_COUNTERPART_LENGTH = 60;

/**
 * A person's name as the loan keeps it: trimmed, inner whitespace collapsed,
 * first letter of each word capitalised ("ravi  kumar" → "Ravi Kumar"), cut at
 * 60 characters. Letters after the first are left as typed, so "McDonald" and
 * "D'Souza" survive.
 */
export function cleanCounterpart(raw: string): string {
  const words = raw
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => {
      const [first = ''] = Array.from(word);
      return first.toLocaleUpperCase() + word.slice(first.length);
    });
  return Array.from(words.join(' ')).slice(0, MAX_COUNTERPART_LENGTH).join('').trimEnd();
}

export function isSyncedLoan(
  loan: PersonalLoan,
): loan is PersonalLoan & { synced: SyncedLoanLink } {
  return Boolean(loan.synced);
}

/** The group expenses that stand for a loan, to be left out of any spending total. */
export function syncedExpenseIds(loans: readonly PersonalLoan[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const loan of loans) if (loan.synced) ids.add(loan.synced.expenseId);
  return ids;
}

export interface SyncedLoanExpenseInput {
  readonly direction: PersonalLoan['direction'];
  readonly amount: bigint;
  readonly currency: string;
  readonly date: string;
  readonly myMemberId: string;
  readonly otherMemberId: string;
  /** What the group calls the debt; the person's name when empty. */
  readonly note: string | null;
  readonly counterpart: string;
}

/** The expense a group write takes (the shape `useWriteExpense` accepts). */
export interface SyncedLoanExpense {
  readonly description: string;
  readonly expenseDate: string;
  readonly currency: string;
  readonly amount: bigint;
  readonly participants: string[];
  readonly payers: Readonly<Record<string, bigint>>;
  readonly splitParams: {
    readonly kind: 'exact';
    readonly amounts: Readonly<Record<string, bigint>>;
  };
}

/**
 * The one expense that books a loan in the 1:1 group. Lender pays the lot; the
 * borrower's share is the lot; the lender's share is zero — so the borrower owes
 * the lender exactly `amount` and nobody else's balance moves.
 */
export function syncedLoanExpense(input: SyncedLoanExpenseInput): SyncedLoanExpense {
  const lent = input.direction === 'lent';
  const lender = lent ? input.myMemberId : input.otherMemberId;
  const borrower = lent ? input.otherMemberId : input.myMemberId;
  return {
    description: input.note?.trim() || input.counterpart,
    expenseDate: input.date,
    currency: input.currency,
    amount: input.amount,
    participants: [input.myMemberId, input.otherMemberId],
    payers: { [lender]: input.amount },
    splitParams: { kind: 'exact', amounts: { [borrower]: input.amount, [lender]: 0n } },
  };
}

/**
 * Why a loan cannot be shared (null when it can). A loan needs a person, a
 * positive amount, and not to be shared twice.
 */
export function shareBlocker(
  loan: Pick<PersonalLoan, 'counterpart' | 'principal' | 'synced' | 'status'>,
): 'already' | 'closed' | 'no-name' | 'no-amount' | null {
  if (loan.synced) return 'already';
  if (loan.status === 'closed') return 'closed';
  if (cleanCounterpart(loan.counterpart).length === 0) return 'no-name';
  if (loan.principal <= 0n) return 'no-amount';
  return null;
}

/**
 * A 1:1 group already made for this person by an earlier shared loan, so a
 * second loan to Ravi lands in the same group and the two add up on one balance
 * instead of making a second group. Matched on the cleaned, case-folded name
 * and the same currency; `exists` is asked whether the group is still around.
 */
export function reusableLink(
  loans: readonly PersonalLoan[],
  counterpart: string,
  currency: string,
  exists: (groupId: string) => boolean,
): SyncedLoanLink | null {
  const key = cleanCounterpart(counterpart).toLocaleLowerCase();
  if (!key) return null;
  for (const loan of loans) {
    if (!loan.synced || loan.currency !== currency) continue;
    if (cleanCounterpart(loan.counterpart).toLocaleLowerCase() !== key) continue;
    if (exists(loan.synced.groupId)) return loan.synced;
  }
  return null;
}

/**
 * What is still outstanding on each shared loan, read off the group balance.
 *
 * `netByGroup` is the viewer's net against the other person in each group and
 * currency (positive: they owe you), straight from `pairBalances`. Per group the
 * net is shared out over that group's loans:
 *  - a positive net is owed on `lent` loans, a negative one on `borrowed` loans;
 *    a loan the net points away from is fully repaid (0);
 *  - repayments clear the oldest loan first, so what remains sits on the newest;
 *  - nothing is ever negative, and an overpayment (net flips sign) leaves 0.
 * Loans in different currencies are never mixed (money never crosses currencies).
 */
export function syncedOutstanding(
  loans: readonly PersonalLoan[],
  netByGroup: ReadonlyMap<string, ReadonlyMap<string, bigint>>,
): Map<string, bigint> {
  const out = new Map<string, bigint>();
  const buckets = new Map<string, PersonalLoan[]>();
  for (const loan of loans) {
    if (!loan.synced) continue;
    const key = `${loan.synced.groupId}|${loan.currency}`;
    const list = buckets.get(key) ?? [];
    list.push(loan);
    buckets.set(key, list);
  }
  for (const bucket of buckets.values()) {
    const [first] = bucket;
    if (!first?.synced) continue;
    const net = netByGroup.get(first.synced.groupId)?.get(first.currency) ?? 0n;
    // Lent loans claim a positive net, borrowed ones a negative net.
    const lentPool = net > 0n ? net : 0n;
    const borrowedPool = net < 0n ? -net : 0n;
    for (const direction of ['lent', 'borrowed'] as const) {
      let pool = direction === 'lent' ? lentPool : borrowedPool;
      const ofDirection = bucket
        .filter((loan) => loan.direction === direction && loan.status === 'active')
        .sort((a, b) =>
          a.startDate === b.startDate ? (a.id < b.id ? 1 : -1) : a.startDate < b.startDate ? 1 : -1,
        );
      // Newest first: older loans are the ones repayments have already cleared.
      for (const loan of ofDirection) {
        const share = pool < loan.principal ? pool : loan.principal;
        out.set(loan.id, share);
        pool -= share;
      }
    }
    for (const loan of bucket) if (!out.has(loan.id)) out.set(loan.id, 0n);
  }
  return out;
}

/** Totals of what is outstanding, one per currency and direction (never mixed). */
export interface LoanTotal {
  readonly currency: string;
  readonly direction: PersonalLoan['direction'];
  readonly amount: bigint;
}

export function loanTotals(
  loans: readonly PersonalLoan[],
  outstanding: ReadonlyMap<string, bigint>,
): LoanTotal[] {
  const sums = new Map<string, LoanTotal>();
  for (const loan of loans) {
    const left = outstanding.get(loan.id);
    if (!left || left <= 0n) continue;
    const key = `${loan.currency}|${loan.direction}`;
    const prior = sums.get(key);
    sums.set(key, {
      currency: loan.currency,
      direction: loan.direction,
      amount: (prior?.amount ?? 0n) + left,
    });
  }
  return [...sums.values()].sort((a, b) =>
    (a.currency + a.direction).localeCompare(b.currency + b.direction),
  );
}

/**
 * May the shared debt be taken back out of the group? Only while nothing has
 * been repaid on it: once part is settled, removing the expense would rewrite a
 * balance the other person has already acted on. Then the loan stays shared and
 * the answer is to settle the rest.
 */
export function canUnlink(loan: PersonalLoan, outstanding: ReadonlyMap<string, bigint>): boolean {
  if (!loan.synced) return false;
  const left = outstanding.get(loan.id);
  return left === undefined || left === loan.principal;
}

/** The loan with its link removed (kept as a private loan). */
export function withoutLink(loan: PersonalLoan): PersonalLoan {
  return { ...loan, synced: null };
}

/** The loan with its link set and the right status for what is outstanding. */
export function withLink(loan: PersonalLoan, link: SyncedLoanLink): PersonalLoan {
  return { ...loan, synced: link };
}

/**
 * Undo of "Yes, Ravi owes me" (shared or not): what to remove and what to put
 * back. The personal txn comes back under the SAME id with every carried field,
 * so a later sync cannot see it as a different record; the shared expense (if
 * any) is the group-side delete.
 */
export interface LendUndoPlan {
  readonly deleteLoanId: string;
  readonly deleteGroupExpense: { readonly groupId: string; readonly expenseId: string } | null;
  readonly restoreTxn: PersonalTxn;
}

export function planLendUndo(loan: PersonalLoan, original: PersonalTxn): LendUndoPlan {
  return {
    deleteLoanId: loan.id,
    deleteGroupExpense: loan.synced
      ? { groupId: loan.synced.groupId, expenseId: loan.synced.expenseId }
      : null,
    restoreTxn: original,
  };
}

/** Whether a repayment in another currency may be matched to the loan (never). */
export function sameCurrency(loan: Pick<PersonalLoan, 'currency'>, currency: string): boolean {
  return loan.currency === currency;
}
