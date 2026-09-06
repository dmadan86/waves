/**
 * The private personal-finance ledger (A48): the shapes the app works in, and
 * the codecs between them and the opaque `data` blob a `personal_records` row
 * carries on the wire.
 *
 * Four record kinds share one table (see PersonalRecord in the schema): a `txn`
 * (an expense or income line), a `recurring` rule that mints txns, a `loan` owed
 * either way, and a monthly `budget` cap. Money is a `bigint` of minor units in
 * the app and a decimal string on the wire, like everywhere else; the decoders
 * are defensive so a malformed blob degrades to a sane default rather than
 * throwing in a list render.
 */

import type { CurrencyCode } from '../money/currency';
import { parseAmount, serialiseAmount, type PersonalRecordKind } from '../sync/protocol';

export type { PersonalRecordKind };

/** An expense leaves the wallet; income comes into it. */
export type TxnKind = 'expense' | 'income';
/**
 * How often a recurring rule fires. Interval multiplies it ("every 2 weeks"),
 * which is what makes fortnightly, quarterly and half-yearly reachable without
 * a case each: `weekly × 2`, `monthly × 3`, `monthly × 6`.
 *
 * `semimonthly` is the exception that earns its own case. Twice a month is not
 * "every N of anything" — the 1st and the 16th are fifteen days apart one way
 * and thirteen to sixteen the other, and a fortnightly rule drifts off the
 * calendar within a year (26 payments, not 24). It is two days of the month, so
 * it is stored as two days of the month: `anchorDate`'s day and `secondDay`.
 */
export type Cadence = 'weekly' | 'semimonthly' | 'monthly' | 'yearly';
/** `borrowed` = money you owe; `lent` = money owed to you. */
export type LoanDirection = 'borrowed' | 'lent';

export interface PersonalTxn {
  readonly id: string;
  readonly kind: TxnKind;
  readonly amount: bigint;
  readonly currency: CurrencyCode;
  readonly category: string | null;
  readonly note: string | null;
  /** YYYY-MM-DD. */
  readonly date: string;
  /** Set when this txn is a repayment on a loan; links the two. */
  readonly loanId: string | null;
  /** Set when a recurring rule minted this txn (idempotency: rule id + date). */
  readonly recurringId: string | null;
}

export interface PersonalRecurring {
  readonly id: string;
  readonly txnKind: TxnKind;
  readonly amount: bigint;
  readonly currency: CurrencyCode;
  readonly category: string | null;
  readonly note: string | null;
  readonly cadence: Cadence;
  /** Every `interval` cadence units (1 = every week/month/year). Ignored by
   *  `semimonthly`, which is twice a month by definition. */
  readonly interval: number;
  /** The month day of the *second* occurrence when `cadence` is `semimonthly`
   *  (the first is `anchorDate`'s day); null for every other cadence. A day past
   *  the end of a short month lands on that month's last day. */
  readonly secondDay: number | null;
  /** First occurrence. */
  readonly anchorDate: string;
  /** The next date this rule is due to fire. Advanced as occurrences post. */
  readonly nextDate: string;
  /** Stop firing after this date; null runs forever. */
  readonly endDate: string | null;
  /** True → mint the txn automatically when due; false → only remind. */
  readonly autoPost: boolean;
  readonly active: boolean;
}

export interface PersonalLoan {
  readonly id: string;
  readonly direction: LoanDirection;
  /** Who the loan is with — a free-text name, not a member id. */
  readonly counterpart: string;
  readonly principal: bigint;
  readonly currency: CurrencyCode;
  readonly note: string | null;
  readonly startDate: string;
  readonly status: 'active' | 'closed';
}

export interface PersonalBudget {
  readonly id: string;
  /** The category this caps, or null for an overall monthly cap. */
  readonly category: string | null;
  readonly limit: bigint;
  readonly currency: CurrencyCode;
}

// ───────────────────────────────────────────────── defensive readers ──

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const bool = (v: unknown): boolean => v === true;
const int = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
const money = (v: unknown): bigint => {
  try {
    return parseAmount(String(v ?? '0'));
  } catch {
    return 0n;
  }
};
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
const dayOfMonth = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 31 ? v : null;

// ─────────────────────────────────────────────────────────── decoders ──

export function decodeTxn(id: string, data: Record<string, unknown>): PersonalTxn {
  return {
    id,
    kind: oneOf(data.kind, ['expense', 'income'] as const, 'expense'),
    amount: money(data.amount),
    currency: str(data.currency) ?? 'INR',
    category: str(data.category),
    note: str(data.note),
    date: str(data.date) ?? '',
    loanId: str(data.loanId),
    recurringId: str(data.recurringId),
  };
}

export function decodeRecurring(id: string, data: Record<string, unknown>): PersonalRecurring {
  const anchor = str(data.anchorDate) ?? '';
  return {
    id,
    txnKind: oneOf(data.txnKind, ['expense', 'income'] as const, 'expense'),
    amount: money(data.amount),
    currency: str(data.currency) ?? 'INR',
    category: str(data.category),
    note: str(data.note),
    cadence: oneOf(
      data.cadence,
      ['weekly', 'semimonthly', 'monthly', 'yearly'] as const,
      'monthly',
    ),
    interval: int(data.interval, 1),
    // A day outside 1–31 is not a day of any month, so it degrades to "no
    // second day" and the rule reads as an ordinary monthly one rather than
    // firing on a date that cannot exist.
    secondDay: dayOfMonth(data.secondDay),
    anchorDate: anchor,
    nextDate: str(data.nextDate) ?? anchor,
    endDate: str(data.endDate),
    autoPost: bool(data.autoPost),
    active: data.active === undefined ? true : bool(data.active),
  };
}

export function decodeLoan(id: string, data: Record<string, unknown>): PersonalLoan {
  return {
    id,
    direction: oneOf(data.direction, ['borrowed', 'lent'] as const, 'borrowed'),
    counterpart: str(data.counterpart) ?? '',
    principal: money(data.principal),
    currency: str(data.currency) ?? 'INR',
    note: str(data.note),
    startDate: str(data.startDate) ?? '',
    status: oneOf(data.status, ['active', 'closed'] as const, 'active'),
  };
}

export function decodeBudget(id: string, data: Record<string, unknown>): PersonalBudget {
  return {
    id,
    category: str(data.category),
    limit: money(data.limit),
    currency: str(data.currency) ?? 'INR',
  };
}

// ─────────────────────────────────────────────────────────── encoders ──
// The `data` blob for an upsert payload. Money is serialised to a decimal
// string; nulls are kept explicit so an edit that clears a field really clears
// it in the mirror overlay.

export function encodeTxn(txn: Omit<PersonalTxn, 'id'>): Record<string, unknown> {
  return {
    kind: txn.kind,
    amount: serialiseAmount(txn.amount),
    currency: txn.currency,
    category: txn.category,
    note: txn.note,
    date: txn.date,
    loanId: txn.loanId,
    recurringId: txn.recurringId,
  };
}

export function encodeRecurring(rule: Omit<PersonalRecurring, 'id'>): Record<string, unknown> {
  return {
    txnKind: rule.txnKind,
    amount: serialiseAmount(rule.amount),
    currency: rule.currency,
    category: rule.category,
    note: rule.note,
    cadence: rule.cadence,
    interval: rule.interval,
    secondDay: rule.secondDay,
    anchorDate: rule.anchorDate,
    nextDate: rule.nextDate,
    endDate: rule.endDate,
    autoPost: rule.autoPost,
    active: rule.active,
  };
}

export function encodeLoan(loan: Omit<PersonalLoan, 'id'>): Record<string, unknown> {
  return {
    direction: loan.direction,
    counterpart: loan.counterpart,
    principal: serialiseAmount(loan.principal),
    currency: loan.currency,
    note: loan.note,
    startDate: loan.startDate,
    status: loan.status,
  };
}

export function encodeBudget(budget: Omit<PersonalBudget, 'id'>): Record<string, unknown> {
  return {
    category: budget.category,
    limit: serialiseAmount(budget.limit),
    currency: budget.currency,
  };
}
