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
 *
 * FORWARD COMPATIBILITY, AND WHY `carried` EXISTS.
 *
 * These decoders are *total*: every field has a fallback, so a blob written by
 * an older app always reads, and a field added later simply defaults. That is
 * what makes adding a field a one-line change with no migration script.
 *
 * The hazard is the way back out. A decode that keeps only the fields it knows
 * about, followed by an encode, is lossy — and in an app where the same ledger
 * is open on two phones, that is silent data loss caused by nothing worse than
 * one of them being a version behind:
 *
 *     new phone writes  { amount, kind: 'subscription' }
 *     old phone decodes { amount }                       ← `kind` dropped here
 *     old phone edits the note and writes back
 *     → `kind` is now gone, on both phones, for good
 *
 * So each decoder keeps whatever it did not recognise in `carried`, and each
 * encoder writes it back out first — known fields are spread after it, so a
 * carried value can never shadow one this version actually understands. An old
 * app now round-trips a new field instead of deleting it.
 *
 * The rule for anyone adding a field: add it to the interface, to the decoder,
 * to the encoder, AND to that kind's `KNOWN_*` set. Miss the last one and the
 * field is written twice — once by the encoder and once out of `carried` —
 * which still round-trips correctly but keeps a stale copy alive forever.
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
  /** How it was paid or received — 'cash', 'upi', 'card', 'bank', 'wallet' or
   *  'other'. Absent on entries written before the field existed, and on ones
   *  where nobody said; the ledger's arithmetic never reads it. */
  readonly paymentMethod?: string | null;
  /** Where it happened, as a name ("Phoenix Mall"). Set by the voice agent's
   *  follow-up question; absent otherwise. Never part of any total. */
  readonly place?: string | null;
  /** A work spend to claim back. Never changes a total; it only marks the entry. */
  readonly reimbursable?: boolean;
  /** The object key of a receipt photo kept for this entry, in the private
   *  `receipts` bucket under `personal/<owner id>/…`. Only the owner can be
   *  signed a URL for it (r2-sign). Absent when there is none. Lives in the
   *  blob, not a column, so it needs no migration and the server never sees
   *  which entries have one. */
  readonly receiptKey?: string | null;
  /** The investment this entry puts money into (or takes out of). */
  readonly investmentId?: string | null;
  /** The rental property this repair, tax or rent entry belongs to. */
  readonly propertyId?: string | null;
  /** Fields from the stored blob this version of the app did not recognise,
   *  kept so that editing a record here never deletes something a newer
   *  version wrote. Re-emitted by the encoder; see the note at the top. */
  readonly carried?: Readonly<Record<string, unknown>>;
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
  /** The investment this rule feeds (an SIP), if any. */
  readonly investmentId?: string | null;
  /** The tenancy this rent rule belongs to, if any. */
  readonly tenancyId?: string | null;
  /** Fields from the stored blob this version of the app did not recognise,
   *  kept so that editing a record here never deletes something a newer
   *  version wrote. Re-emitted by the encoder; see the note at the top. */
  readonly carried?: Readonly<Record<string, unknown>>;
}

/**
 * The group-side half of a loan shared with the other person: the 1:1 group,
 * the one expense that books the debt there, and the two member rows. The loan
 * and that expense are linked by these ids so nothing is counted twice and
 * either side can be found from the other (see `syncedLoan.ts`).
 */
export interface SyncedLoanLink {
  readonly groupId: string;
  readonly expenseId: string;
  readonly myMemberId: string;
  readonly otherMemberId: string;
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
  /** Set once the loan is shared with the other person as a debt in a 1:1 group. */
  readonly synced?: SyncedLoanLink | null;
  /** How many times the loan has been unshared. Each share books its debt under
   *  an expense id derived from this, because an unshared expense is soft-deleted
   *  and a later write to the same id would not bring it back. Absent means 0. */
  readonly shareSeq?: number;
  /** Fields from the stored blob this version of the app did not recognise,
   *  kept so that editing a record here never deletes something a newer
   *  version wrote. Re-emitted by the encoder; see the note at the top. */
  readonly carried?: Readonly<Record<string, unknown>>;
}

export interface PersonalBudget {
  readonly id: string;
  /** The category this caps, or null for an overall monthly cap. */
  readonly category: string | null;
  readonly limit: bigint;
  readonly currency: CurrencyCode;
  /** Fields from the stored blob this version of the app did not recognise,
   *  kept so that editing a record here never deletes something a newer
   *  version wrote. Re-emitted by the encoder; see the note at the top. */
  readonly carried?: Readonly<Record<string, unknown>>;
}

/** What a private date is about. */
export type DateLabelKind =
  'my_birthday' | 'anniversary' | 'work_anniversary' | 'family_birthday' | 'other';

export const DATE_LABEL_KINDS: readonly DateLabelKind[] = [
  'my_birthday',
  'anniversary',
  'work_anniversary',
  'family_birthday',
  'other',
];

/** A private date: day + month, never a year — except `year` on a work
 *  anniversary, the year the job started, so "N years" can be said. Only the
 *  owner's own devices ever see it. */
export interface PersonalDate {
  readonly id: string;
  readonly label: DateLabelKind;
  /** Whose / what it is; empty for my_birthday and anniversary. */
  readonly name: string;
  readonly day: number;
  readonly month: number;
  readonly year: number | null;
  readonly carried?: Readonly<Record<string, unknown>>;
}

/** Neutral categories. Region examples (SIP, 401k, ISA, Super) are hints in the
 *  UI chosen by country, never part of the stored value. `chit` is an India-only
 *  hint, shown only there. */
export type InvestmentType =
  | 'fund'
  | 'stocks'
  | 'deposit'
  | 'retirement'
  | 'metals'
  | 'bonds'
  | 'insurance'
  | 'crypto'
  | 'chit'
  | 'other';
export const INVESTMENT_TYPES: readonly InvestmentType[] = [
  'fund',
  'stocks',
  'deposit',
  'retirement',
  'metals',
  'bonds',
  'insurance',
  'crypto',
  'chit',
  'other',
];
export type WealthStatus = 'active' | 'closed';

/** A holding the person tracks. `currentValue` is their own entered figure,
 *  never a computed or advised one. */
export interface PersonalInvestment {
  readonly id: string;
  readonly type: InvestmentType;
  readonly name: string;
  readonly currency: CurrencyCode;
  /** What was already invested before this app tracked it. */
  readonly openingInvested: bigint;
  readonly openingAsOf: string | null;
  readonly currentValue: bigint | null;
  readonly valueAsOf: string | null;
  readonly maturityDate: string | null;
  readonly status: WealthStatus;
  readonly note: string | null;
  readonly carried?: Readonly<Record<string, unknown>>;
}

export type PropertyType = 'house' | 'flat' | 'shop' | 'commercial' | 'pg' | 'land' | 'other';
export const PROPERTY_TYPES: readonly PropertyType[] = [
  'house',
  'flat',
  'shop',
  'commercial',
  'pg',
  'land',
  'other',
];

export interface PersonalProperty {
  readonly id: string;
  readonly type: PropertyType;
  readonly name: string;
  readonly locality: string | null;
  readonly currency: CurrencyCode;
  readonly status: WealthStatus;
  readonly note: string | null;
  readonly carried?: Readonly<Record<string, unknown>>;
}

/** Who rents a property. Only a name and a phone are kept: no ID numbers. The
 *  advance is a field here, never a txn: it is held money, not income. */
export interface PersonalTenancy {
  readonly id: string;
  readonly propertyId: string;
  readonly unit: string | null;
  readonly tenantName: string;
  readonly tenantPhone: string | null;
  readonly depositHeld: bigint;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly escalationPct: number | null;
  readonly status: WealthStatus;
  readonly endedOn: string | null;
  readonly depositReturned: bigint | null;
  /** The part of the advance the landlord kept; counts as income. */
  readonly depositKept: bigint | null;
  readonly note: string | null;
  readonly carried?: Readonly<Record<string, unknown>>;
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

// ──────────────────────────────────────────────── forward compatibility ──

/** Every key each kind's encoder writes. A key here is understood by this
 *  version and must NOT be carried; a key absent from it is the future's, and
 *  is. Kept beside the codecs so the three move together. */
const KNOWN_TXN = [
  'kind',
  'amount',
  'currency',
  'category',
  'note',
  'date',
  'loanId',
  'recurringId',
  'paymentMethod',
  'place',
  'reimbursable',
  'receiptKey',
  'investmentId',
  'propertyId',
];
const KNOWN_RECURRING = [
  'txnKind',
  'amount',
  'currency',
  'category',
  'note',
  'cadence',
  'interval',
  'secondDay',
  'anchorDate',
  'nextDate',
  'endDate',
  'autoPost',
  'active',
  'investmentId',
  'tenancyId',
];
const KNOWN_LOAN = [
  'direction',
  'counterpart',
  'principal',
  'currency',
  'note',
  'startDate',
  'status',
  'synced',
  'shareSeq',
];
const KNOWN_BUDGET = ['category', 'limit', 'currency'];
const KNOWN_DATE = ['label', 'name', 'day', 'month', 'year'];
const KNOWN_INVESTMENT = [
  'type',
  'name',
  'currency',
  'openingInvested',
  'openingAsOf',
  'currentValue',
  'valueAsOf',
  'maturityDate',
  'status',
  'note',
];
const KNOWN_PROPERTY = ['type', 'name', 'locality', 'currency', 'status', 'note'];
const KNOWN_TENANCY = [
  'propertyId',
  'unit',
  'tenantName',
  'tenantPhone',
  'depositHeld',
  'startDate',
  'endDate',
  'escalationPct',
  'status',
  'endedOn',
  'depositReturned',
  'depositKept',
  'note',
];

/**
 * Whatever the blob holds that this version has no field for.
 *
 * Undefined rather than `{}` when there is nothing, so the common case adds no
 * key to the decoded record and nothing downstream has to special-case an empty
 * object.
 */
function carry(
  data: Record<string, unknown>,
  known: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  let extra: Record<string, unknown> | undefined;
  for (const key of Object.keys(data)) {
    if (known.includes(key)) continue;
    // `id` is the row's, not the blob's — the decoders take it as an argument.
    // Carrying it would write a second, shadow copy into the payload.
    if (key === 'id') continue;
    extra ??= {};
    extra[key] = data[key];
  }
  return extra;
}

/**
 * The encoded blob, with the unrecognised fields put back.
 *
 * Carried first and known second, so a field this version understands always
 * wins. The alternative — carried last — would let a stale value from a blob
 * overwrite the edit the person just made, which is the bug this whole
 * mechanism exists to prevent, arriving from the other direction.
 */
function withCarried(
  encoded: Record<string, unknown>,
  carried: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  return carried ? { ...carried, ...encoded } : encoded;
}

// ─────────────────────────────────────────────────────────── decoders ──

export function decodeTxn(id: string, data: Record<string, unknown>): PersonalTxn {
  const paymentMethod = str(data.paymentMethod);
  const place = str(data.place);
  const reimbursable = data.reimbursable === true;
  const receiptKey = str(data.receiptKey);
  const investmentId = str(data.investmentId);
  const propertyId = str(data.propertyId);
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
    // Only when the blob has one, so an entry without it decodes exactly as it
    // did before the field existed.
    ...(paymentMethod !== null ? { paymentMethod } : {}),
    ...(place !== null ? { place } : {}),
    ...(reimbursable ? { reimbursable } : {}),
    ...(receiptKey !== null ? { receiptKey } : {}),
    ...(investmentId !== null ? { investmentId } : {}),
    ...(propertyId !== null ? { propertyId } : {}),
    carried: carry(data, KNOWN_TXN),
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
    ...(str(data.investmentId) !== null ? { investmentId: str(data.investmentId) } : {}),
    ...(str(data.tenancyId) !== null ? { tenancyId: str(data.tenancyId) } : {}),
    carried: carry(data, KNOWN_RECURRING),
  };
}

/** The link, or null unless all four ids are present strings (a half link is no link). */
function decodeSyncedLink(raw: unknown): SyncedLoanLink | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const link = raw as Record<string, unknown>;
  const { groupId, expenseId, myMemberId, otherMemberId } = link;
  if (
    typeof groupId !== 'string' ||
    typeof expenseId !== 'string' ||
    typeof myMemberId !== 'string' ||
    typeof otherMemberId !== 'string' ||
    !groupId ||
    !expenseId ||
    !myMemberId ||
    !otherMemberId
  ) {
    return null;
  }
  return { groupId, expenseId, myMemberId, otherMemberId };
}

export function decodeLoan(id: string, data: Record<string, unknown>): PersonalLoan {
  const synced = decodeSyncedLink(data.synced);
  // A `synced` value this version cannot read (a newer shape) is kept verbatim.
  const unread = synced === null && data.synced != null ? { synced: data.synced } : null;
  const carried = carry(data, KNOWN_LOAN);
  return {
    id,
    direction: oneOf(data.direction, ['borrowed', 'lent'] as const, 'borrowed'),
    counterpart: str(data.counterpart) ?? '',
    principal: money(data.principal),
    currency: str(data.currency) ?? 'INR',
    note: str(data.note),
    startDate: str(data.startDate) ?? '',
    status: oneOf(data.status, ['active', 'closed'] as const, 'active'),
    synced,
    ...(typeof data.shareSeq === 'number' && Number.isInteger(data.shareSeq) && data.shareSeq > 0
      ? { shareSeq: data.shareSeq }
      : {}),
    carried: unread ? { ...carried, ...unread } : carried,
  };
}

export function decodeBudget(id: string, data: Record<string, unknown>): PersonalBudget {
  return {
    id,
    category: str(data.category),
    limit: money(data.limit),
    currency: str(data.currency) ?? 'INR',
    carried: carry(data, KNOWN_BUDGET),
  };
}

/** Total like the rest: an impossible day/month reads as 1 Jan rather than throwing. */
export function decodeDate(id: string, data: Record<string, unknown>): PersonalDate {
  const month =
    typeof data.month === 'number' && data.month >= 1 && data.month <= 12
      ? Math.floor(data.month)
      : 1;
  const day = dayOfMonth(data.day) ?? 1;
  return {
    id,
    label: oneOf(data.label, DATE_LABEL_KINDS, 'other'),
    name: str(data.name) ?? '',
    day,
    month,
    year:
      typeof data.year === 'number' && Number.isInteger(data.year) && data.year > 1900
        ? data.year
        : null,
    carried: carry(data, KNOWN_DATE),
  };
}

const moneyOrNull = (v: unknown): bigint | null => (v == null || v === '' ? null : money(v));

export function decodeInvestment(id: string, data: Record<string, unknown>): PersonalInvestment {
  return {
    id,
    type: oneOf(data.type, INVESTMENT_TYPES, 'other'),
    name: str(data.name) ?? '',
    currency: str(data.currency) ?? 'INR',
    openingInvested: money(data.openingInvested),
    openingAsOf: str(data.openingAsOf),
    currentValue: moneyOrNull(data.currentValue),
    valueAsOf: str(data.valueAsOf),
    maturityDate: str(data.maturityDate),
    status: oneOf(data.status, ['active', 'closed'] as const, 'active'),
    note: str(data.note),
    carried: carry(data, KNOWN_INVESTMENT),
  };
}

export function decodeProperty(id: string, data: Record<string, unknown>): PersonalProperty {
  return {
    id,
    type: oneOf(data.type, PROPERTY_TYPES, 'other'),
    name: str(data.name) ?? '',
    locality: str(data.locality),
    currency: str(data.currency) ?? 'INR',
    status: oneOf(data.status, ['active', 'closed'] as const, 'active'),
    note: str(data.note),
    carried: carry(data, KNOWN_PROPERTY),
  };
}

export function decodeTenancy(id: string, data: Record<string, unknown>): PersonalTenancy {
  const pct = data.escalationPct;
  return {
    id,
    propertyId: str(data.propertyId) ?? '',
    unit: str(data.unit),
    tenantName: str(data.tenantName) ?? '',
    tenantPhone: str(data.tenantPhone),
    depositHeld: money(data.depositHeld),
    startDate: str(data.startDate) ?? '',
    endDate: str(data.endDate),
    escalationPct: typeof pct === 'number' && Number.isFinite(pct) && pct > 0 ? pct : null,
    status: oneOf(data.status, ['active', 'closed'] as const, 'active'),
    endedOn: str(data.endedOn),
    depositReturned: moneyOrNull(data.depositReturned),
    depositKept: moneyOrNull(data.depositKept),
    note: str(data.note),
    carried: carry(data, KNOWN_TENANCY),
  };
}

// ─────────────────────────────────────────────────────────── encoders ──
// The `data` blob for an upsert payload. Money is serialised to a decimal
// string; nulls are kept explicit so an edit that clears a field really clears
// it in the mirror overlay.

export function encodeTxn(txn: Omit<PersonalTxn, 'id'>): Record<string, unknown> {
  return withCarried(
    {
      kind: txn.kind,
      amount: serialiseAmount(txn.amount),
      currency: txn.currency,
      category: txn.category,
      note: txn.note,
      date: txn.date,
      loanId: txn.loanId,
      recurringId: txn.recurringId,
      // Written only when set, so an entry that never had one stays byte-for-byte
      // the blob it always was.
      paymentMethod: txn.paymentMethod ?? null,
      place: txn.place ?? null,
      reimbursable: !!txn.reimbursable,
      receiptKey: txn.receiptKey ?? null,
      ...(txn.investmentId ? { investmentId: txn.investmentId } : {}),
      ...(txn.propertyId ? { propertyId: txn.propertyId } : {}),
    },
    txn.carried,
  );
}

export function encodeRecurring(rule: Omit<PersonalRecurring, 'id'>): Record<string, unknown> {
  return withCarried(
    {
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
      ...(rule.investmentId ? { investmentId: rule.investmentId } : {}),
      ...(rule.tenancyId ? { tenancyId: rule.tenancyId } : {}),
    },
    rule.carried,
  );
}

export function encodeLoan(loan: Omit<PersonalLoan, 'id'>): Record<string, unknown> {
  return withCarried(
    {
      direction: loan.direction,
      counterpart: loan.counterpart,
      principal: serialiseAmount(loan.principal),
      currency: loan.currency,
      note: loan.note,
      startDate: loan.startDate,
      status: loan.status,
      ...(loan.synced ? { synced: loan.synced } : {}),
      ...(loan.shareSeq ? { shareSeq: loan.shareSeq } : {}),
    },
    loan.carried,
  );
}

export function encodeBudget(budget: Omit<PersonalBudget, 'id'>): Record<string, unknown> {
  return withCarried(
    {
      category: budget.category,
      limit: serialiseAmount(budget.limit),
      currency: budget.currency,
    },
    budget.carried,
  );
}

export function encodeDate(d: Omit<PersonalDate, 'id'>): Record<string, unknown> {
  return withCarried(
    { label: d.label, name: d.name, day: d.day, month: d.month, year: d.year },
    d.carried,
  );
}

const serialiseOrNull = (v: bigint | null): string | null =>
  v === null ? null : serialiseAmount(v);

export function encodeInvestment(i: Omit<PersonalInvestment, 'id'>): Record<string, unknown> {
  return withCarried(
    {
      type: i.type,
      name: i.name,
      currency: i.currency,
      openingInvested: serialiseAmount(i.openingInvested),
      openingAsOf: i.openingAsOf,
      currentValue: serialiseOrNull(i.currentValue),
      valueAsOf: i.valueAsOf,
      maturityDate: i.maturityDate,
      status: i.status,
      note: i.note,
    },
    i.carried,
  );
}

export function encodeProperty(p: Omit<PersonalProperty, 'id'>): Record<string, unknown> {
  return withCarried(
    {
      type: p.type,
      name: p.name,
      locality: p.locality,
      currency: p.currency,
      status: p.status,
      note: p.note,
    },
    p.carried,
  );
}

export function encodeTenancy(t: Omit<PersonalTenancy, 'id'>): Record<string, unknown> {
  return withCarried(
    {
      propertyId: t.propertyId,
      unit: t.unit,
      tenantName: t.tenantName,
      tenantPhone: t.tenantPhone,
      depositHeld: serialiseAmount(t.depositHeld),
      startDate: t.startDate,
      endDate: t.endDate,
      escalationPct: t.escalationPct,
      status: t.status,
      endedOn: t.endedOn,
      depositReturned: serialiseOrNull(t.depositReturned),
      depositKept: serialiseOrNull(t.depositKept),
      note: t.note,
    },
    t.carried,
  );
}
