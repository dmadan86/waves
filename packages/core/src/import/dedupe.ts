/**
 * "Is this the dinner I already entered?"
 *
 * Run on the phone against the group's current expenses, before anything is
 * written. It only suggests: two identical coffees on one day is normal, and
 * whether a row is the same expense is the person's call on the review screen.
 * The server's only duty is idempotency, never judgement.
 */

import { normaliseMerchantName, merchantTokens } from '../category/merchant';

export interface DedupeRow {
  readonly key: string;
  /** YYYY-MM-DD. */
  readonly date: string;
  readonly currency: string;
  readonly amount: bigint;
  readonly description: string;
}

export interface ExistingExpense {
  readonly id: string;
  readonly date: string;
  readonly currency: string;
  readonly amount: bigint;
  readonly description: string;
}

export interface ImportDuplicateMatch {
  readonly expenseId: string;
  /** `likely`: same day, amount and wording (leave unticked). `possible`: close (tick, but warn). */
  readonly level: 'likely' | 'possible';
}

export interface DuplicateReport {
  /** Row key to the existing expense it resembles. */
  readonly existing: ReadonlyMap<string, ImportDuplicateMatch>;
  /** Row key to the key of the earlier identical row in the same file. Informational. */
  readonly withinFile: ReadonlyMap<string, string>;
}

const DAY_MS = 86_400_000;

const dayNumber = (iso: string): number =>
  Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY_MS);

const exactKey = (row: {
  currency: string;
  amount: bigint;
  date: string;
  description: string;
}): string =>
  `${row.currency}:${row.amount}:${row.date.slice(0, 10)}:${normaliseMerchantName(row.description)}`;

function jaccard(a: readonly string[], b: readonly string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size === 0 && right.size === 0) return 1;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

export function findDuplicates(
  rows: readonly DedupeRow[],
  existing: readonly ExistingExpense[],
): DuplicateReport {
  const byKey = new Map<string, ExistingExpense>();
  const byAmount = new Map<string, ExistingExpense[]>();
  for (const expense of existing) {
    byKey.set(exactKey(expense), expense);
    const bucket = `${expense.currency}:${expense.amount}`;
    byAmount.set(bucket, [...(byAmount.get(bucket) ?? []), expense]);
  }

  const matches = new Map<string, ImportDuplicateMatch>();
  const withinFile = new Map<string, string>();
  const firstSeen = new Map<string, string>();

  for (const row of rows) {
    const key = exactKey(row);
    const same = byKey.get(key);
    if (same) {
      matches.set(row.key, { expenseId: same.id, level: 'likely' });
    } else {
      const tokens = merchantTokens(row.description);
      const day = dayNumber(row.date);
      const near = (byAmount.get(`${row.currency}:${row.amount}`) ?? []).find(
        (expense) =>
          Math.abs(dayNumber(expense.date) - day) <= 1 &&
          jaccard(tokens, merchantTokens(expense.description)) >= 0.5,
      );
      if (near) matches.set(row.key, { expenseId: near.id, level: 'possible' });
    }

    const earlier = firstSeen.get(key);
    if (earlier !== undefined) withinFile.set(row.key, earlier);
    else firstSeen.set(key, row.key);
  }
  return { existing: matches, withinFile };
}
