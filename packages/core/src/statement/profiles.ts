/**
 * Spreadsheet and CSV statements from the five big Indian banks, read without a
 * model.
 *
 * Each bank exports its own columns. A profile is the set of header names that
 * identifies one (compared the way the rest of the importers compare headers:
 * case, punctuation and spacing do not matter) and what each column means. A
 * file that matches no profile is not guessed at: the app hands it to the column
 * mapper and lets the person say which column is which.
 *
 * Dates in these exports are always day-first, so the order is fixed rather than
 * detected. Amounts are read digit by digit (ADR-003).
 *
 * These layouts were written from the banks' published formats and synthetic
 * fixtures, not from live exports; the profile ids are what telemetry-free
 * support would ask about ("it read my file as ICICI").
 */

import { parseLooseAmount } from '../import/amount';
import { resolveDates } from '../import/date';
import { squashHeader } from '../import/layout';
import type { TableRead } from '../import/table';
import { applyBalanceCheck } from './balance';
import { referenceFor } from './narration';
import type { StatementRow } from './types';

export type BankProfileId = 'hdfc' | 'icici' | 'sbi' | 'axis' | 'kotak';

interface ColumnNames {
  readonly date: readonly string[];
  readonly description: readonly string[];
  readonly ref?: readonly string[];
  readonly debit?: readonly string[];
  readonly credit?: readonly string[];
  /** One amount column, with a Dr/Cr marker in `drcr`. */
  readonly amount?: readonly string[];
  readonly drcr?: readonly string[];
  readonly balance: readonly string[];
}

export interface BankProfile {
  readonly id: BankProfileId;
  readonly bank: string;
  /** Squashed header names that must all be present. */
  readonly required: readonly string[];
  readonly columns: ColumnNames;
}

export const BANK_PROFILES: readonly BankProfile[] = [
  {
    id: 'hdfc',
    bank: 'HDFC Bank',
    required: ['narration', 'withdrawalamt', 'depositamt', 'closingbalance'],
    columns: {
      date: ['date'],
      description: ['narration'],
      ref: ['chqrefno'],
      debit: ['withdrawalamt'],
      credit: ['depositamt'],
      balance: ['closingbalance'],
    },
  },
  {
    id: 'icici',
    bank: 'ICICI Bank',
    required: ['transactionremarks', 'withdrawalamountinr', 'depositamountinr', 'balanceinr'],
    columns: {
      date: ['transactiondate', 'valuedate'],
      description: ['transactionremarks'],
      ref: ['chequenumber'],
      debit: ['withdrawalamountinr'],
      credit: ['depositamountinr'],
      balance: ['balanceinr'],
    },
  },
  {
    id: 'sbi',
    bank: 'State Bank of India',
    required: ['txndate', 'description', 'debit', 'credit', 'balance'],
    columns: {
      date: ['txndate'],
      description: ['description'],
      ref: ['refnochequeno'],
      debit: ['debit'],
      credit: ['credit'],
      balance: ['balance'],
    },
  },
  {
    id: 'axis',
    bank: 'Axis Bank',
    required: ['trandate', 'particulars', 'dr', 'cr', 'bal'],
    columns: {
      date: ['trandate'],
      description: ['particulars'],
      ref: ['chqno'],
      debit: ['dr'],
      credit: ['cr'],
      balance: ['bal'],
    },
  },
  {
    id: 'kotak',
    bank: 'Kotak Mahindra Bank',
    required: ['transactiondate', 'description', 'amount', 'drcr', 'balance'],
    columns: {
      date: ['transactiondate'],
      description: ['description'],
      ref: ['chqrefno'],
      amount: ['amount'],
      drcr: ['drcr'],
      balance: ['balance'],
    },
  },
];

/** Statement exports start with account details; the header is within the first lines. */
const HEADER_SEARCH_ROWS = 40;

export interface ProfileMatch {
  readonly profile: BankProfile;
  /** Index into `table.rows` of the header row. */
  readonly headerRow: number;
  /** Column index by role. */
  readonly columns: Readonly<Partial<Record<keyof ColumnNames, number>>>;
}

/** Which bank's export is this table, or null when it is none of the five. */
export function detectBankProfile(table: TableRead): ProfileMatch | null {
  const limit = Math.min(table.rows.length, HEADER_SEARCH_ROWS);
  for (let headerRow = 0; headerRow < limit; headerRow += 1) {
    const squashed = table.rows[headerRow]!.map((cell) => squashHeader(cell));
    for (const profile of BANK_PROFILES) {
      if (!profile.required.every((name) => squashed.includes(name))) continue;
      const columns: Partial<Record<keyof ColumnNames, number>> = {};
      for (const [role, names] of Object.entries(profile.columns) as [
        keyof ColumnNames,
        readonly string[],
      ][]) {
        // Names are in order of preference ("transactiondate" before "valuedate").
        for (const name of names) {
          const at = squashed.indexOf(name);
          if (at >= 0) {
            columns[role] = at;
            break;
          }
        }
      }
      return { profile, headerRow, columns };
    }
  }
  return null;
}

export interface TableParseOptions {
  /** `YYYY-MM-DD`, for two-digit years. */
  readonly today?: string;
  readonly currency?: 'INR';
}

export type TableParseResult =
  | {
      readonly ok: true;
      /** The bank, or `generic` for a layout read from its headers alone. */
      readonly profile: BankProfileId | 'generic';
      readonly bank: string | null;
      readonly rows: StatementRow[];
      /** Lines under the header that were not transactions (totals, notes, blanks). */
      readonly skipped: number;
      readonly balanceChecked: number;
      readonly balanceFailed: number;
    }
  | { readonly ok: false; readonly reason: 'unknown_layout' | 'no_transactions' };

const TRAILING_DRCR = /\s*(cr|dr)\.?$/i;

/** A balance cell: "1,234.50", "1,234.50 Cr", "1,234.50 Dr" (overdrawn). Signed minor units. */
function readBalance(cell: string | undefined): string | null {
  const text = (cell ?? '').trim();
  if (text === '') return null;
  const overdrawn = /dr\.?$/i.test(text);
  const parsed = parseLooseAmount(text.replace(TRAILING_DRCR, ''), 'INR', 'dot');
  if (!parsed.ok) return null;
  const minor = overdrawn ? -parsed.minor : parsed.minor;
  return minor.toString();
}

/** An unsigned amount cell, or null when empty or unreadable. */
function readAmount(cell: string | undefined): bigint | null {
  const text = (cell ?? '').trim().replace(TRAILING_DRCR, '');
  if (text === '' || /^[-–—]+$/.test(text)) return null;
  const parsed = parseLooseAmount(text, 'INR', 'dot');
  if (!parsed.ok) return null;
  return parsed.minor < 0n ? -parsed.minor : parsed.minor;
}

interface LayoutMatch {
  readonly id: BankProfileId | 'generic';
  readonly bank: string | null;
  readonly headerRow: number;
  readonly columns: Readonly<Partial<Record<keyof ColumnNames, number>>>;
}

/** Header words of banks that are not one of the five, by the role they play. */
const GENERIC_HEADERS: Readonly<Record<keyof ColumnNames, readonly string[]>> = {
  date: [
    'date',
    'txndate',
    'trandate',
    'transactiondate',
    'postingdate',
    'valuedate',
    'bookingdate',
  ],
  description: [
    'description',
    'narration',
    'particulars',
    'details',
    'remarks',
    'transactionremarks',
    'transactiondetails',
    'transactiondescription',
  ],
  ref: [
    'chqrefno',
    'refno',
    'chequeno',
    'chqno',
    'chequenumber',
    'reference',
    'referenceno',
    'utr',
  ],
  debit: [
    'debit',
    'withdrawal',
    'withdrawals',
    'withdrawalamt',
    'withdrawalamount',
    'dr',
    'debitamount',
    'moneyout',
    'paidout',
  ],
  credit: [
    'credit',
    'deposit',
    'deposits',
    'depositamt',
    'depositamount',
    'cr',
    'creditamount',
    'moneyin',
    'paidin',
  ],
  amount: ['amount'],
  drcr: ['drcr', 'crdr', 'type'],
  balance: ['balance', 'closingbalance', 'runningbalance', 'bal', 'availablebalance'],
};

/**
 * A bank that is not one of the five, recognised by the words in its header
 * alone: a date, a description, and either separate debit and credit columns or
 * one amount with a Dr/Cr marker. Anything less is not guessed at.
 */
export function detectGenericLayout(table: TableRead): LayoutMatch | null {
  const limit = Math.min(table.rows.length, HEADER_SEARCH_ROWS);
  for (let headerRow = 0; headerRow < limit; headerRow += 1) {
    const squashed = table.rows[headerRow]!.map((cell) => squashHeader(cell));
    const columns: Partial<Record<keyof ColumnNames, number>> = {};
    for (const role of Object.keys(GENERIC_HEADERS) as (keyof ColumnNames)[]) {
      const at = squashed.findIndex(
        (name, i) => GENERIC_HEADERS[role].includes(name) && !Object.values(columns).includes(i),
      );
      if (at >= 0) columns[role] = at;
    }
    const split = columns.debit !== undefined && columns.credit !== undefined;
    const marked = columns.amount !== undefined && columns.drcr !== undefined;
    if (columns.date !== undefined && columns.description !== undefined && (split || marked)) {
      return { id: 'generic', bank: null, headerRow, columns };
    }
  }
  return null;
}

/** Read a statement table whose bank is one of the five, or whose headers say enough. */
export function parseStatementTable(
  table: TableRead,
  options: TableParseOptions = {},
): TableParseResult {
  const bank = detectBankProfile(table);
  if (bank) {
    return readRows(
      table,
      { id: bank.profile.id, bank: bank.profile.bank, ...bank },
      { ...options, order: 'dmy', confidence: 0.95 },
    );
  }
  const generic = detectGenericLayout(table);
  if (generic) return readRows(table, generic, { ...options, order: undefined, confidence: 0.8 });
  return { ok: false, reason: 'unknown_layout' };
}

function readRows(
  table: TableRead,
  match: LayoutMatch,
  options: TableParseOptions & { order: 'dmy' | undefined; confidence: number },
): TableParseResult {
  const { headerRow, columns } = match;

  const body = table.rows.slice(headerRow + 1);
  const dates = resolveDates(
    body.map((row) => row[columns.date ?? -1] ?? ''),
    { order: options.order, allowSerial: true, today: options.today, country: 'IN' },
  );

  const rows: StatementRow[] = [];
  let skipped = 0;
  body.forEach((cells, at) => {
    const description = (cells[columns.description ?? -1] ?? '').trim();
    const iso = dates.cells[at]?.iso ?? null;
    const debit = columns.debit !== undefined ? readAmount(cells[columns.debit]) : null;
    const credit = columns.credit !== undefined ? readAmount(cells[columns.credit]) : null;
    let amount: bigint | null = null;
    let direction: 'debit' | 'credit' | null = null;
    if (columns.amount !== undefined) {
      amount = readAmount(cells[columns.amount]);
      const mark =
        `${cells[columns.drcr ?? -1] ?? ''} ${cells[columns.amount] ?? ''}`.toLowerCase();
      direction = /\b(?:cr|c)\b|cr\.?$/.test(mark)
        ? 'credit'
        : /\b(?:dr|d)\b|dr\.?$/.test(mark)
          ? 'debit'
          : null;
    } else if (debit !== null && debit > 0n) {
      amount = debit;
      direction = 'debit';
    } else if (credit !== null && credit > 0n) {
      amount = credit;
      direction = 'credit';
    }

    if (iso === null || amount === null || direction === null) {
      // A wrapped narration: no date, no amount, just more words for the row above.
      const previous = rows[rows.length - 1];
      if (
        previous &&
        (cells[columns.date ?? -1] ?? '').trim() === '' &&
        amount === null &&
        description !== ''
      ) {
        rows[rows.length - 1] = {
          ...previous,
          description: `${previous.description} ${description}`,
        };
        return;
      }
      skipped += 1;
      return;
    }

    rows.push({
      index: rows.length,
      date: iso,
      description: description === '' ? 'Transaction' : description,
      amount: amount.toString(),
      direction,
      ref: referenceFor(columns.ref !== undefined ? cells[columns.ref] : null, description),
      balance: readBalance(columns.balance !== undefined ? cells[columns.balance] : undefined),
      confidence: options.confidence,
      warnings: amount === 0n ? ['zero_amount'] : [],
    });
  });

  if (rows.length === 0) return { ok: false, reason: 'no_transactions' };
  const checked = applyBalanceCheck(rows);
  return {
    ok: true,
    profile: match.id,
    bank: match.bank,
    rows: checked.rows,
    skipped,
    balanceChecked: checked.checked,
    balanceFailed: checked.failed,
  };
}
