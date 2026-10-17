/**
 * The shapes a bank statement row passes through, wherever it was read from:
 * a CSV, a spreadsheet, the text layer of a PDF, or a model reading an image.
 *
 * Amounts are decimal strings of minor units (ADR-003): rows cross JSON between
 * the edge function and the app, and a string cannot lose a paisa the way a
 * float can. Use `BigInt(row.amount)` to compute.
 */

export type StatementDirection = 'debit' | 'credit';

export type StatementRowWarning =
  | 'bad_date'
  | 'zero_amount'
  | 'low_confidence'
  /** `previous balance +/- amount` did not give the printed balance. */
  | 'balance_mismatch';

export interface StatementRow {
  /** Position in the source, so a dropped row leaves the others stable. */
  readonly index: number;
  /** YYYY-MM-DD, or null when the source gave none or it was not a real date. */
  readonly date: string | null;
  readonly description: string;
  /** Unsigned minor units, digits only. */
  readonly amount: string;
  readonly direction: StatementDirection;
  /** UTR / RRN / cheque number, upper-cased, when the row carries one. */
  readonly ref: string | null;
  /** Running balance after the row, signed minor units, when printed. */
  readonly balance: string | null;
  /** 0..1. Deterministic parses report how sure the layout match was. */
  readonly confidence: number;
  readonly warnings: readonly StatementRowWarning[];
}

export type StatementWarningCode =
  'rows_dropped_invalid' | 'summary_rows_dropped' | 'rows_truncated' | 'no_rows';

export interface StatementWarning {
  readonly code: StatementWarningCode;
  readonly count: number;
}

export interface StatementExtraction {
  /** ISO 4217 the statement is in, when it said. */
  readonly currency: string | null;
  readonly rows: readonly StatementRow[];
  readonly openingBalance: string | null;
  readonly warnings: readonly StatementWarning[];
}
