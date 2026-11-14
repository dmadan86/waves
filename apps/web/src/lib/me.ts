/**
 * The Me page's logic that is not a screen: the private ledger read from the
 * mirror, grouped by day, and a statement row turned into a ledger entry.
 * Sums come from @waves/core (personal/spending); nothing here adds money up
 * a second way.
 */

import {
  decodeTxn,
  encodeTxn,
  guessCategory,
  materialisePersonalRecords,
  parseMajor,
  parseNarration,
  personalCategoryTotals,
  type CategorySpend,
  type CurrencyCode,
  type ExistingExpense,
  type MirrorState,
  type PersonalTxn,
  type StatementItem,
  type StatementRow,
} from '@waves/core';

/** The signed-in person's own live txns, newest day first. Other record kinds are not shown here. */
export function ledgerTxns(mirror: MirrorState, ownerId: string): PersonalTxn[] {
  return materialisePersonalRecords(mirror, [], { ownerId })
    .filter((record) => record.record_kind === 'txn')
    .map((record) => decodeTxn(record.id, record.data))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export interface DayGroup {
  readonly date: string;
  readonly txns: PersonalTxn[];
  /** Expenses that day in `currency`, minor units. */
  readonly spent: bigint;
}

export function groupByDay(txns: readonly PersonalTxn[], currency: string): DayGroup[] {
  const days = new Map<string, PersonalTxn[]>();
  for (const txn of txns) days.set(txn.date, [...(days.get(txn.date) ?? []), txn]);
  return [...days].map(([date, list]) => ({
    date,
    txns: list,
    spent: list
      .filter((t) => t.kind === 'expense' && t.currency === currency)
      .reduce((sum, t) => sum + t.amount, 0n),
  }));
}

/** `YYYY-MM` of a `YYYY-MM-DD`. */
export const monthOf = (date: string): string => date.slice(0, 7);

/** Months that hold an entry, newest first, always including `current`. */
export function monthsWithEntries(txns: readonly PersonalTxn[], current: string): string[] {
  return [...new Set([current, ...txns.map((t) => monthOf(t.date))])].sort().reverse();
}

export function monthTotals(
  txns: readonly PersonalTxn[],
  month: string,
  currency: string,
): CategorySpend[] {
  return personalCategoryTotals(txns, [month], currency as CurrencyCode);
}

/** The currency the ledger mostly speaks, so the headline is not a stray holiday's. */
export function mainCurrency(txns: readonly PersonalTxn[], fallback = 'INR'): string {
  const counts = new Map<string, number>();
  for (const t of txns) counts.set(t.currency, (counts.get(t.currency) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
}

export interface EntryForm {
  kind: 'expense' | 'income';
  amountText: string;
  category: string | null;
  note: string;
  date: string;
}

/** The form to the wire blob; null when the amount is not a positive amount. */
export function entryData(
  form: EntryForm,
  currency: string,
  carried?: PersonalTxn,
): Record<string, unknown> | null {
  let minor: bigint;
  try {
    minor = parseMajor(form.amountText.trim(), currency as CurrencyCode).minor;
  } catch {
    return null;
  }
  if (minor <= 0n || !/^\d{4}-\d{2}-\d{2}$/.test(form.date)) return null;
  return encodeTxn({
    ...(carried ?? { loanId: null, recurringId: null }),
    kind: form.kind,
    amount: minor,
    currency: currency as CurrencyCode,
    category: form.category,
    note: form.note.trim() || null,
    date: form.date,
  });
}

// ---- statement rows into entries ---------------------------------------------

/** What the dedupe check compares a statement against: the ledger's own expenses. */
export function existingExpenses(txns: readonly PersonalTxn[]): ExistingExpense[] {
  return txns
    .filter((t) => t.kind === 'expense')
    .map((t) => ({
      id: t.id,
      date: t.date,
      currency: t.currency,
      amount: t.amount,
      description: t.note ?? t.category ?? '',
    }));
}

/**
 * A record id that is the same every time the same statement row is confirmed
 * for the same person, so a double click or a second upload upserts one record
 * instead of adding another. A v4-shaped uuid from SHA-256 of owner and key.
 */
export async function recordIdFor(ownerId: string, key: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`stmt:${ownerId}:${key}`)),
  );
  digest[6] = (digest[6]! & 0x0f) | 0x40;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface RowEdit {
  category?: string | null;
  /** Major units as typed. */
  amountText?: string;
}

/** Who or what the row is about, in the statement's own words (the same rule as the phone). */
export function draftDescription(narration: string): string {
  const text = parseNarration(narration).counterparty ?? narration.replace(/\s+/g, ' ').trim();
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

/** The review row's starting category: a guess from the wording, as mobile does. */
export const guessFor = (item: StatementItem): string | null =>
  guessCategory(draftDescription(item.row.description));

/** One ticked review row as a ledger entry; null when its edited amount is not valid. */
export function statementEntry(
  item: StatementItem,
  edit: RowEdit,
  currency: string,
  today: string,
): Record<string, unknown> | null {
  const description = draftDescription(item.row.description);
  const amountText = edit.amountText;
  let amount = BigInt(item.row.amount);
  if (amountText !== undefined) {
    try {
      amount = parseMajor(amountText.trim(), currency as CurrencyCode).minor;
    } catch {
      return null;
    }
  }
  if (amount <= 0n) return null;
  return encodeTxn({
    kind: item.row.direction === 'credit' ? 'income' : 'expense',
    amount,
    currency: currency as CurrencyCode,
    category: edit.category === undefined ? guessFor(item) : edit.category,
    note: description,
    date: item.row.date ?? today,
    loanId: null,
    recurringId: null,
  });
}

/** First and last day of a `YYYY-MM`. */
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/**
 * Rows worded the way their entries will be (the counterparty, not the bank's
 * whole narration), so the duplicate check compares like with like when the
 * same statement comes round again.
 */
export function wordedAsEntries(rows: readonly StatementRow[]): StatementRow[] {
  return rows.map((row) => ({ ...row, description: draftDescription(row.description) }));
}
