/**
 * Which column is which.
 *
 * A file arrives from Splitwise, Tricount, Settle Up, a Google Sheet somebody
 * made last Diwali, or our own export. This reads the header row and says what
 * each column holds, with a few words of Hindi, Tamil and Arabic so a sheet
 * headed `तारीख` or `தொகை` needs no mapping step. The result is plain data a
 * screen can show and let the person correct.
 */

import { foldToken } from '../text/digits';
import { detectDecimalStyle, type DecimalStyle } from './amount';
import { resolveDates, type DateBasis, type ImportDateOrder } from './date';
import type { TableRead } from './table';

export type FieldKey =
  | 'date'
  | 'description'
  | 'amount'
  | 'amount_minor'
  | 'currency'
  | 'paid_by'
  | 'split'
  | 'category'
  | 'type'
  | 'status'
  | 'version'
  | 'owed_by'
  | 'owed_amount_minor'
  | 'group';

/** Case, accent, punctuation and spacing do not matter: `Paid By`, `paid_by` and `PAIDBY` agree. */
export function squashHeader(header: string): string {
  return foldToken(header.replace(/^﻿/, '')).replace(/[^\p{L}\p{N}\p{M}]+/gu, '');
}

const SYNONYMS: Readonly<Record<FieldKey, readonly string[]>> = {
  date: [
    'date',
    'day',
    'when',
    'transaction date',
    'txn date',
    'expense date',
    'tarikh',
    'तारीख',
    'தேதி',
    'تاريخ',
  ],
  description: [
    'description',
    'desc',
    'item',
    'title',
    'what',
    'details',
    'note',
    'notes',
    'narration',
    'particulars',
    'expense',
    'merchant',
    'purpose',
    'विवरण',
    'விவரம்',
    'وصف',
  ],
  amount: [
    'amount',
    'cost',
    'total',
    'price',
    'value',
    'sum',
    'amt',
    'debit',
    'spent',
    'rs',
    'inr',
    'राशि',
    'தொகை',
    'المبلغ',
  ],
  amount_minor: ['amount_minor'],
  currency: ['currency', 'ccy', 'cur', 'curr'],
  paid_by: ['paid by', 'payer', 'paid', 'who paid', 'from', 'भुगतानकर्ता'],
  split: [
    'split',
    'split between',
    'split among',
    'split with',
    'for',
    'participants',
    'shared with',
    'between',
    'for whom',
    'impacted to',
  ],
  category: ['category', 'tag'],
  type: ['type'],
  status: ['status'],
  version: ['version'],
  owed_by: ['owed_by'],
  owed_amount_minor: ['owed_amount_minor'],
  group: ['group'],
};

const LOOKUP: ReadonlyMap<string, FieldKey> = new Map(
  (Object.entries(SYNONYMS) as [FieldKey, readonly string[]][]).flatMap(([field, words]) =>
    words.map((word) => [squashHeader(word), field] as const),
  ),
);

/** The field a header names, or null. */
export function fieldForHeader(header: string): FieldKey | null {
  return LOOKUP.get(squashHeader(header)) ?? null;
}

export type LayoutKind = 'splitwise' | 'waves_csv' | 'generic';

export interface PersonColumn {
  readonly name: string;
  readonly column: number;
}

export interface DetectedLayout {
  readonly kind: LayoutKind;
  /** Index into the table's rows of the header, or -1 when nothing looked like one. */
  readonly headerRow: number;
  readonly columns: Readonly<Partial<Record<FieldKey, number>>>;
  /** Splitwise's one-net-per-person columns, or member-named columns in a wide sheet. */
  readonly personColumns: readonly PersonColumn[];
  /** Null when the file mixes both orders. */
  readonly dateOrder: ImportDateOrder | null;
  readonly dateBasis: DateBasis;
  /** The order was a guess from the country; a screen should show the choice. */
  readonly dateAmbiguous: boolean;
  readonly dateMixed: boolean;
  readonly decimalStyle: DecimalStyle;
  readonly decimalAmbiguous: boolean;
}

export interface DetectLayoutOptions {
  /** Names of the people already in the group, so a column headed with one is a person column. */
  readonly members?: readonly string[];
  readonly country?: string | null;
  readonly today?: string;
}

const SPLITWISE_FIXED = ['date', 'description', 'category', 'cost', 'currency'];

function columnsOf(header: readonly string[]): Partial<Record<FieldKey, number>> {
  const columns: Partial<Record<FieldKey, number>> = {};
  header.forEach((cell, index) => {
    const squashed = squashHeader(cell);
    // Waves' own export spells these with underscores; the squash would lose nothing, but exact names win.
    const field = LOOKUP.get(squashed);
    if (field && columns[field] === undefined) columns[field] = index;
  });
  return columns;
}

function isSplitwiseHeader(header: readonly string[]): boolean {
  return (
    SPLITWISE_FIXED.every((name, index) => squashHeader(header[index] ?? '') === name) &&
    header.slice(SPLITWISE_FIXED.length).some((cell) => cell.trim() !== '')
  );
}

/**
 * Read the header and the data under it.
 *
 * Looks at the first ten rows for the header (exports sometimes start with a
 * title or a `sep=` note), then settles the file-wide questions from the data:
 * day or month first, comma or dot decimals.
 */
export function detectLayout(table: TableRead, options: DetectLayoutOptions = {}): DetectedLayout {
  let headerRow = -1;
  let best = 0;
  for (let index = 0; index < Math.min(table.rows.length, 10); index += 1) {
    const columns = columnsOf(table.rows[index]!);
    const found = Object.keys(columns).length;
    const anchored =
      columns.date !== undefined ||
      columns.amount !== undefined ||
      columns.amount_minor !== undefined;
    if (found >= 2 && anchored && found > best) {
      best = found;
      headerRow = index;
    }
  }
  if (headerRow < 0 && table.rows[0] && isSplitwiseHeader(table.rows[0])) headerRow = 0;

  const header = headerRow >= 0 ? table.rows[headerRow]! : [];
  const data = headerRow >= 0 ? table.rows.slice(headerRow + 1) : [];

  let kind: LayoutKind = 'generic';
  let columns = columnsOf(header);
  let personColumns: PersonColumn[] = [];

  if (isSplitwiseHeader(header)) {
    kind = 'splitwise';
    columns = { date: 0, description: 1, category: 2, amount: 3, currency: 4 };
    personColumns = header
      .map((name, column) => ({ name: name.replace(/^﻿/, '').trim(), column }))
      .slice(SPLITWISE_FIXED.length)
      .filter((entry) => entry.name !== '');
  } else if (
    columns.amount_minor !== undefined &&
    columns.owed_by !== undefined &&
    columns.owed_amount_minor !== undefined
  ) {
    kind = 'waves_csv';
  } else if (options.members?.length) {
    const known = new Map(options.members.map((name) => [squashHeader(name), name] as const));
    const taken = new Set(Object.values(columns));
    personColumns = header.flatMap((cell, column) => {
      const name = known.get(squashHeader(cell));
      return name && !taken.has(column) ? [{ name, column }] : [];
    });
  }

  const cellsOf = (field: FieldKey): string[] => {
    const column = columns[field];
    return column === undefined ? [] : data.map((row) => row[column] ?? '');
  };

  const dates = resolveDates(cellsOf('date'), {
    country: options.country,
    allowSerial: true,
    today: options.today,
  });
  const decimals =
    kind === 'splitwise'
      ? { style: 'dot' as const, ambiguous: false }
      : detectDecimalStyle(cellsOf('amount'));

  return {
    kind,
    headerRow,
    columns,
    personColumns,
    dateOrder: dates.order,
    dateBasis: dates.basis,
    dateAmbiguous: dates.ambiguous,
    dateMixed: dates.mixed,
    decimalStyle: decimals.style,
    decimalAmbiguous: decimals.ambiguous,
  };
}
