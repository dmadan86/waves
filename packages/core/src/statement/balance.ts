/**
 * The one check a bank statement offers for free: each row prints the balance
 * after it, so `previous balance +/- amount` must equal it.
 *
 * It catches a misread digit, a dropped row, a debit read as a credit and a
 * model that invented a transaction, from the statement's own arithmetic and
 * with no second opinion needed. A row that fails starts unticked in Review.
 *
 * Pure and idempotent: any earlier `balance_mismatch` is cleared first, so the
 * check can be re-run on the merged rows of a file that was read in chunks.
 */

import type { StatementRow, StatementRowWarning } from './types';

export interface BalanceCheckOptions {
  /** The balance before the first row (chronologically), when the statement says. */
  readonly openingBalance?: string | null;
}

export interface BalanceCheckResult {
  readonly rows: StatementRow[];
  /** Rows that had a balance and a neighbour to compare it with. */
  readonly checked: number;
  /** Of those, how many did not add up. */
  readonly failed: number;
  /** Which way the file runs: oldest first, or newest first. */
  readonly order: 'oldest_first' | 'newest_first';
}

const signed = (row: StatementRow): bigint =>
  row.direction === 'credit' ? BigInt(row.amount) : -BigInt(row.amount);

/**
 * Per row: true when it adds up, false when it does not, null when there was
 * nothing to compare it with. `previous(i)` names the chronologically earlier row.
 */
function verdicts(
  rows: readonly StatementRow[],
  opening: bigint | null,
  newestFirst: boolean,
): (boolean | null)[] {
  return rows.map((row, i) => {
    if (row.balance === null) return null;
    const before = newestFirst ? rows[i + 1] : rows[i - 1];
    let start: bigint | null;
    if (before) {
      if (before.balance === null) return null;
      start = BigInt(before.balance);
    } else {
      start = opening;
    }
    if (start === null) return null;
    return start + signed(row) === BigInt(row.balance);
  });
}

const tally = (list: readonly (boolean | null)[]): number => list.filter((v) => v === true).length;

export function applyBalanceCheck(
  input: readonly StatementRow[],
  options: BalanceCheckOptions = {},
): BalanceCheckResult {
  const rows = input.map((row) => ({
    ...row,
    warnings: row.warnings.filter((w) => w !== 'balance_mismatch'),
  }));
  const opening = options.openingBalance != null ? BigInt(options.openingBalance) : null;

  const oldest = verdicts(rows, opening, false);
  const newest = verdicts(rows, opening, true);
  const useNewest = tally(newest) > tally(oldest);
  const verdict = useNewest ? newest : oldest;

  let checked = 0;
  let failed = 0;
  const out = rows.map((row, i) => {
    const ok = verdict[i];
    if (ok === null || ok === undefined) return row;
    checked += 1;
    if (ok) return row;
    failed += 1;
    const warnings: StatementRowWarning[] = [...row.warnings, 'balance_mismatch'];
    return { ...row, warnings };
  });
  return {
    rows: out,
    checked,
    failed,
    order: useNewest ? 'newest_first' : 'oldest_first',
  };
}
