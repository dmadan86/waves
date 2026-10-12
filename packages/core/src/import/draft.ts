/**
 * The one shape every import source is read into.
 *
 * A Splitwise export, a Waves export, a Google Sheet and (later) a screenshot
 * all become an {@link ImportDraft}: rows that say what the file said, in the
 * file's own words (names as written, splits as written), with every doubt
 * attached to the row it concerns. Nothing here knows about a group. Turning a
 * draft into exact payers and shares for a particular group is `resolveDraft`.
 *
 * Bad rows are kept, with error issues, rather than dropped: a review screen
 * needs to show them, and the compatibility wrappers turn them back into the
 * flat problem lists the older callers expect.
 */

import { isCurrencyCode, type CurrencyCode } from '../money/currency';
import { splitEqually } from '../split/computeShares';
import { categoryFor } from './categoryMap';
import { parseLooseAmount, type DecimalStyle } from './amount';
import { resolveDates, type DateCell } from './date';
import { detectLayout, squashHeader, type DetectedLayout } from './layout';
import { ImportProblemKind, type ImportProblem } from './problem';
import { readTable, type TableRead } from './table';
import { nameMap } from './nameMap';

export type ImportSource = 'csv' | 'splitwise' | 'waves_csv' | 'waves_json' | 'xlsx' | 'screenshot';

/** Refuse more than this many data rows; the write path commits in chunks of at most this much. */
export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export interface ImportIssue {
  readonly severity: 'error' | 'warning';
  readonly code: ImportProblemKind;
  readonly field: keyof ImportDraftRow | null;
  /** English, for logs. Screens translate `code`. */
  readonly message: string;
}

export type DraftPayers = Readonly<Record<string, bigint>> | { readonly single: string } | null;

export type DraftSplit =
  | { readonly kind: 'equal'; readonly among: readonly string[] | 'everyone' }
  | { readonly kind: 'shares'; readonly weights: Readonly<Record<string, number>> }
  | { readonly kind: 'percent'; readonly basisPoints: Readonly<Record<string, number>> }
  | { readonly kind: 'exact'; readonly amounts: Readonly<Record<string, bigint>> }
  /** Splitwise: each person's net (paid minus owed) for the row. */
  | { readonly kind: 'net'; readonly nets: Readonly<Record<string, bigint>> };

export interface ImportDraftRow {
  /** Stable: `${source}:${line}`, or the index for a screenshot. */
  readonly key: string;
  /** 1-based line in the file; null for a screenshot. */
  readonly row: number | null;
  readonly kind: 'expense' | 'settlement';
  /** YYYY-MM-DD. */
  readonly date: string | null;
  readonly description: string;
  /** One of our category ids, or null. */
  readonly category: string | null;
  /** The category exactly as the source wrote it. */
  readonly rawCategory: string | null;
  /** Null means the group's default currency. */
  readonly currency: CurrencyCode | null;
  /** Minor units, above zero. */
  readonly amount: bigint | null;
  /** Names as they appear in the source. Null means "whoever is importing". */
  readonly payers: DraftPayers;
  readonly split: DraftSplit | null;
  readonly settlement?: { readonly from: string; readonly to: string };
  /** From a screenshot reader only, 0..1. */
  readonly confidence: number | null;
  readonly issues: readonly ImportIssue[];
}

export interface ImportDraft {
  readonly source: ImportSource;
  /** Every distinct name referenced, in order of first appearance. */
  readonly people: readonly string[];
  readonly rows: readonly ImportDraftRow[];
  readonly fileProblems: readonly ImportProblem[];
  /** Null for a source with no columns to detect (a screenshot, a JSON export). */
  readonly detected: DetectedLayout | null;
}

export interface DraftOptions {
  /** The group's country, for the day/month default. */
  readonly country?: string | null;
  /** `YYYY-MM-DD`; only the year is used, for two-digit years. */
  readonly today?: string;
  /** Currency whose decimals apply to a row that names none. Defaults to INR. */
  readonly defaultCurrency?: CurrencyCode;
}

export function isSinglePayer(payers: DraftPayers): payers is { readonly single: string } {
  return payers !== null && typeof (payers as { single?: unknown }).single === 'string';
}

// ── small helpers ───────────────────────────────────────────────────────────

export const issueOf = (
  severity: ImportIssue['severity'],
  code: ImportProblemKind,
  field: ImportIssue['field'],
  message: string,
): ImportIssue => ({ severity, code, field, message });

/** Error issues as the flat problem list the older callers expect. */
export function draftProblems(draft: ImportDraft): ImportProblem[] {
  const problems: ImportProblem[] = [...draft.fileProblems];
  for (const row of draft.rows) {
    for (const found of row.issues) {
      if (found.severity === 'error') {
        problems.push({ kind: found.code, row: row.row, message: found.message });
      }
    }
  }
  return problems;
}

/**
 * Names, deduplicated the way a person would: "asha " and "Asha" are the same
 * person, and the first spelling seen is the one shown.
 */
class NameBook {
  readonly names: string[] = [];
  private readonly seen = new Map<string, string>();

  private static key(name: string): string {
    return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  /** The canonical spelling, or null for a blank name. */
  add(raw: string): string | null {
    const clean = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
    if (clean === '') return null;
    const key = NameBook.key(clean);
    const known = this.seen.get(key);
    if (known !== undefined) return known;
    this.seen.set(key, clean);
    this.names.push(clean);
    return clean;
  }
}

const emptyRow = (
  source: ImportSource,
  line: number | null,
  index: number,
  kind: ImportDraftRow['kind'],
): Pick<ImportDraftRow, 'key' | 'row' | 'kind' | 'confidence'> => ({
  key: `${source}:${line ?? index}`,
  row: line,
  kind,
  confidence: null,
});

const failure = (
  source: ImportSource,
  line: number,
  description: string,
  issues: ImportIssue[],
  extra: Partial<ImportDraftRow> = {},
): ImportDraftRow => ({
  ...emptyRow(source, line, line, 'expense'),
  date: null,
  description,
  category: null,
  rawCategory: null,
  currency: null,
  amount: null,
  payers: null,
  split: null,
  issues,
  ...extra,
});

function dateIssue(cell: DateCell | undefined, line: number): ImportIssue | null {
  if (cell && cell.iso) return null;
  if (cell?.failure === 'mixed') {
    return issueOf(
      'error',
      ImportProblemKind.MixedDateFormats,
      'date',
      `Row ${line}: this file mixes day-first and month-first dates, so this one cannot be read.`,
    );
  }
  return issueOf(
    'error',
    ImportProblemKind.UnparseableRow,
    'date',
    `Row ${line}: could not read the date.`,
  );
}

function amountIssue(
  failureKind: 'empty' | 'unreadable' | 'too_many_decimals',
  line: number,
  currency: CurrencyCode,
  text: string,
): ImportIssue {
  if (failureKind === 'too_many_decimals') {
    return issueOf(
      'error',
      ImportProblemKind.TooManyDecimals,
      'amount',
      `Row ${line}: "${text}" has more decimals than ${currency} allows.`,
    );
  }
  return issueOf(
    'error',
    ImportProblemKind.UnparseableRow,
    'amount',
    `Row ${line}: could not read the cost.`,
  );
}

const sumOf = (record: Readonly<Record<string, bigint>>): bigint =>
  Object.values(record).reduce((total, value) => total + value, 0n);

// ── Splitwise ───────────────────────────────────────────────────────────────

const SPLITWISE_FIXED = ['date', 'description', 'category', 'cost', 'currency'];
const TOTAL_ROW = /^total\s+balance$/i;

const noPeopleDraft = (problems: ImportProblem[]): ImportDraft => ({
  source: 'splitwise',
  people: [],
  rows: [],
  fileProblems: problems,
  detected: null,
});

/**
 * Read a Splitwise export.
 *
 * Each person's column is their net for the row, so a row carries `net` splits
 * and no payers; `resolveDraft` reconstructs who paid. A `Payment` row is
 * somebody settling up, not a shared cost, so it comes back as a settlement.
 */
export function draftFromSplitwise(text: string, options: DraftOptions = {}): ImportDraft {
  return draftFromSplitwiseTable(readTable(text), options);
}

export function draftFromSplitwiseTable(table: TableRead, options: DraftOptions = {}): ImportDraft {
  const header = table.rows[0] ?? [];
  const squashed = header.map(squashHeader);
  const fixedCount = SPLITWISE_FIXED.filter((name) => squashed.includes(name)).length;
  const book = new NameBook();

  // Keep the field index beside each name: a blank person column in the header
  // shifts the people list without shifting the field positions, so reading by
  // list index would attribute every net after the gap to the wrong person.
  const columns = header
    .map((name, column) => ({ name: name.replace(/^﻿/, '').trim(), column }))
    .slice(SPLITWISE_FIXED.length)
    .filter((entry) => entry.name !== '');

  if (fixedCount < SPLITWISE_FIXED.length || columns.length === 0) {
    return noPeopleDraft([
      {
        kind: ImportProblemKind.NoPeople,
        row: 1,
        message:
          'This does not look like a Splitwise export — expected Date, Description, Category, Cost, Currency and then one column per person.',
      },
    ]);
  }

  const personColumns = columns.map((entry) => ({ ...entry, canonical: book.add(entry.name)! }));
  const distinct = new Set(personColumns.map((entry) => entry.canonical));
  if (distinct.size !== personColumns.length) {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const entry of personColumns) {
      if (seen.has(entry.canonical)) dupes.add(entry.canonical);
      seen.add(entry.canonical);
    }
    return noPeopleDraft([
      {
        kind: ImportProblemKind.DuplicatePerson,
        row: 1,
        message: `Splitwise export has duplicate person columns: ${[...dupes].join(', ')}.`,
      },
    ]);
  }

  const data = table.rows.slice(1);
  const dates = resolveDates(
    data.map((row) => row[0] ?? ''),
    { country: options.country, today: options.today },
  );
  const rows: ImportDraftRow[] = [];
  let carried: CurrencyCode = 'INR';

  data.forEach((fields, offset) => {
    const line = table.lines[offset + 1] ?? offset + 2;
    const description = fields[1] ?? '';
    // The summary row is not an expense; importing it would double everything.
    if (TOTAL_ROW.test((fields[0] ?? '').trim()) || TOTAL_ROW.test(description.trim())) return;

    const rawCategory = (fields[2] ?? '').trim() || null;
    const currency = (fields[4] ?? '').trim().toUpperCase() || carried;
    if (!isCurrencyCode(currency)) {
      rows.push(
        failure('splitwise', line, description, [
          issueOf(
            'error',
            ImportProblemKind.UnknownCurrency,
            'currency',
            `Row ${line}: "${fields[4]}" is not a currency code.`,
          ),
        ]),
      );
      return;
    }
    carried = currency;

    const base = { rawCategory, currency, description: description || 'Imported expense' };
    const dateProblem = dateIssue(dates.cells[offset], line);
    const cost = parseLooseAmount(fields[3] ?? '', currency, 'dot');
    if (dateProblem || !cost.ok) {
      const problem =
        dateProblem ?? (cost.ok ? null : amountIssue(cost.reason, line, currency, fields[3] ?? ''));
      rows.push(failure('splitwise', line, base.description, [problem!], base));
      return;
    }
    const date = dates.cells[offset]!.iso;
    if (cost.minor <= 0n) {
      rows.push(
        failure(
          'splitwise',
          line,
          base.description,
          [
            issueOf(
              'error',
              ImportProblemKind.NonPositiveCost,
              'amount',
              `Row ${line} ("${description}"): Splitwise cost must be greater than zero.`,
            ),
          ],
          { ...base, date },
        ),
      );
      return;
    }
    const amount = cost.minor;

    const nets: Record<string, bigint> = nameMap();
    let netTotal = 0n;
    for (const entry of personColumns) {
      const raw = fields[entry.column] ?? '';
      const parsed = parseLooseAmount(raw, currency, 'dot');
      if (!parsed.ok && parsed.reason !== 'empty') {
        rows.push(
          failure(
            'splitwise',
            line,
            base.description,
            [
              issueOf(
                'error',
                ImportProblemKind.UnparseableRow,
                'split',
                `Row ${line} ("${description}"): could not read ${entry.canonical}'s amount.`,
              ),
            ],
            { ...base, date, amount },
          ),
        );
        return;
      }
      const value = parsed.ok ? parsed.minor : 0n;
      nets[entry.canonical] = value;
      netTotal += value;
    }

    // Every row in a correct export sums to zero across people. A row that does
    // not is the one case where importing it would silently corrupt balances,
    // so it is named rather than adjusted into shape.
    if (netTotal !== 0n) {
      rows.push(
        failure(
          'splitwise',
          line,
          base.description,
          [
            issueOf(
              'error',
              ImportProblemKind.RowDoesNotBalance,
              'split',
              `Row ${line} ("${description}"): the people's columns add up to ${netTotal}, not 0.`,
            ),
          ],
          { ...base, date, amount },
        ),
      );
      return;
    }

    if ((rawCategory ?? '').toLowerCase() === 'payment') {
      // Exactly one person paid (positive net) and exactly one received
      // (negative net), each for the whole cost: "Hethu paid Madan" has Hethu
      // +X, Madan −X.
      const creditors = Object.entries(nets).filter(([, net]) => net > 0n);
      const debtors = Object.entries(nets).filter(([, net]) => net < 0n);
      const from = creditors[0];
      const to = debtors[0];
      if (creditors.length !== 1 || debtors.length !== 1 || !from || !to || from[1] !== amount) {
        rows.push(
          failure(
            'splitwise',
            line,
            base.description,
            [
              issueOf(
                'error',
                ImportProblemKind.UnexpectedSettlement,
                'settlement',
                `Row ${line} ("${description}"): a payment should be one person paying one other the full amount; this one is not.`,
              ),
            ],
            { ...base, date, amount },
          ),
        );
        return;
      }
      rows.push({
        ...emptyRow('splitwise', line, line, 'settlement'),
        date,
        description: description || 'Payment',
        category: null,
        rawCategory,
        currency,
        amount,
        payers: null,
        split: null,
        settlement: { from: from[0], to: to[0] },
        issues: [],
      });
      return;
    }

    rows.push({
      ...emptyRow('splitwise', line, line, 'expense'),
      date,
      description: base.description,
      category: categoryFor(rawCategory, description, options.country),
      rawCategory,
      currency,
      amount,
      payers: null,
      split: { kind: 'net', nets },
      issues: [],
    });
  });

  const fileProblems: ImportProblem[] =
    rows.length === 0
      ? [
          {
            kind: ImportProblemKind.NoRows,
            row: null,
            message: 'There were no expenses in this file.',
          },
        ]
      : [];

  return {
    source: 'splitwise',
    people: book.names,
    rows,
    fileProblems,
    detected: detectLayout(table, { country: options.country, today: options.today }),
  };
}

// ── Waves CSV export ────────────────────────────────────────────────────────

const SETTLING = new Set(['confirmed', 'auto_confirmed']);

/** Several payers with no amounts: split the cost between them equally, and say so. */
function equalPayers(
  amount: bigint,
  names: readonly string[],
  seed: string,
): Record<string, bigint> {
  return Object.fromEntries(splitEqually(amount, names, seed));
}

/**
 * Read the CSV Waves writes from Export. Unlike Splitwise it carries each
 * person's real owed amount, so shares are exact; it does not carry payer
 * amounts, so a row with several payers is split between them equally.
 * Deleted expenses and settlements that never confirmed are left out.
 */
export function draftFromWavesCsv(text: string, options: DraftOptions = {}): ImportDraft {
  return draftFromWavesTable(readTable(text), options);
}

export function draftFromWavesTable(table: TableRead, options: DraftOptions = {}): ImportDraft {
  const layout = detectLayout(table, { country: options.country, today: options.today });
  const col = layout.columns;
  if (layout.kind !== 'waves_csv' || layout.headerRow < 0) {
    return {
      source: 'waves_csv',
      people: [],
      rows: [],
      fileProblems: [
        {
          kind: ImportProblemKind.NotAnExport,
          row: 1,
          message: 'This does not look like a Waves CSV export.',
        },
      ],
      detected: layout,
    };
  }

  const data = table.rows.slice(layout.headerRow + 1);
  const dates = resolveDates(
    data.map((row) => row[col.date!] ?? ''),
    { country: options.country, today: options.today, order: layout.dateOrder ?? undefined },
  );
  const book = new NameBook();
  const cell = (row: readonly string[], field: keyof typeof col): string =>
    col[field] === undefined ? '' : (row[col[field]!] ?? '');

  interface Pending {
    line: number;
    date: DateCell | undefined;
    description: string;
    currency: string;
    amountText: string;
    paidBy: string;
    shares: Record<string, bigint>;
    bad: ImportIssue | null;
  }
  const pending = new Map<string, Pending>();
  const rows: ImportDraftRow[] = [];

  data.forEach((fields, offset) => {
    const line = table.lines[layout.headerRow + 1 + offset] ?? offset + 1;
    const type = cell(fields, 'type').toLowerCase();
    const status = cell(fields, 'status').toLowerCase();
    if (type === 'expense (deleted)' || status === 'deleted') return;

    const currency = cell(fields, 'currency').toUpperCase();
    const amountText = cell(fields, 'amount_minor');
    const dateCell = dates.cells[offset];
    const description = cell(fields, 'description');

    if (type === 'settlement') {
      if (!SETTLING.has(status)) return;
      const from = book.add(cell(fields, 'paid_by'));
      const to = book.add(cell(fields, 'owed_by'));
      const problem = dateIssue(dateCell, line);
      if (problem || !from || !to || !/^\d+$/.test(amountText) || !isCurrencyCode(currency)) {
        rows.push(
          failure('waves_csv', line, description, [
            problem ??
              issueOf(
                'error',
                ImportProblemKind.UnparseableRow,
                'settlement',
                `Row ${line}: could not read this settlement.`,
              ),
          ]),
        );
        return;
      }
      rows.push({
        ...emptyRow('waves_csv', line, line, 'settlement'),
        date: dateCell!.iso,
        description: description || 'Payment',
        category: null,
        rawCategory: null,
        currency,
        amount: BigInt(amountText),
        payers: null,
        split: null,
        settlement: { from, to },
        issues: [],
      });
      return;
    }
    if (type !== 'expense') return;

    // One expense is written as one row per person who owes; they share these.
    const key = [
      cell(fields, 'group'),
      dateCell?.iso ?? '',
      description,
      currency,
      amountText,
      cell(fields, 'paid_by'),
      cell(fields, 'version'),
    ].join('\u0000');
    let entry = pending.get(key);
    if (!entry) {
      entry = {
        line,
        date: dateCell,
        description,
        currency,
        amountText,
        paidBy: cell(fields, 'paid_by'),
        shares: {},
        bad: dateIssue(dateCell, line),
      };
      pending.set(key, entry);
    }
    const name = book.add(cell(fields, 'owed_by'));
    const owed = cell(fields, 'owed_amount_minor');
    if (!name || !/^\d+$/.test(owed)) {
      entry.bad ??= issueOf(
        'error',
        ImportProblemKind.UnparseableRow,
        'split',
        `Row ${line}: could not read who owes what.`,
      );
      return;
    }
    entry.shares[name] = (entry.shares[name] ?? 0n) + BigInt(owed);
  });

  for (const entry of pending.values()) {
    const description = entry.description || 'Imported expense';
    const issues: ImportIssue[] = [];
    const amount = /^\d+$/.test(entry.amountText) ? BigInt(entry.amountText) : null;
    const currency = isCurrencyCode(entry.currency) ? entry.currency : null;
    if (entry.bad) issues.push(entry.bad);
    else if (amount === null || amount <= 0n || currency === null) {
      issues.push(
        issueOf(
          'error',
          ImportProblemKind.UnparseableRow,
          'amount',
          `Row ${entry.line}: could not read the cost.`,
        ),
      );
    } else if (sumOf(entry.shares) !== amount) {
      issues.push(
        issueOf(
          'error',
          ImportProblemKind.RowDoesNotBalance,
          'split',
          `Row ${entry.line} ("${description}"): what people owe does not add up to the cost.`,
        ),
      );
    }

    const payerNames = entry.paidBy
      .split(/\s+\+\s+/)
      .map((name) => book.add(name))
      .filter((name): name is string => name !== null);
    let payers: DraftPayers = null;
    if (payerNames.length === 1) payers = { single: payerNames[0]! };
    else if (payerNames.length > 1 && amount !== null && issues.length === 0) {
      payers = equalPayers(amount, payerNames, `waves_csv:${entry.line}`);
      issues.push(
        issueOf(
          'warning',
          ImportProblemKind.PayerEstimated,
          'payers',
          `Row ${entry.line}: the payments were not itemised, so the cost was split between the payers equally.`,
        ),
      );
    }

    rows.push({
      ...emptyRow('waves_csv', entry.line, entry.line, 'expense'),
      date: entry.date?.iso ?? null,
      description,
      category: null,
      rawCategory: null,
      currency,
      amount,
      payers,
      split: { kind: 'exact', amounts: entry.shares },
      issues,
    });
  }
  rows.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));

  return {
    source: 'waves_csv',
    people: book.names,
    rows,
    fileProblems:
      rows.length === 0
        ? [
            {
              kind: ImportProblemKind.NoRows,
              row: null,
              message: 'There were no expenses in this file.',
            },
          ]
        : [],
    detected: layout,
  };
}

// ── generic table ───────────────────────────────────────────────────────────

const SPLIT_SEPARATORS = /\s*[;|/,]\s*|\s+and\s+/i;
const PAYER_SEPARATORS = /\s*[+;&|]\s*|\s+and\s+/i;
const EVERYONE = /^(everyone|everybody|all)$/i;
const SETTLEMENT_TYPES = new Set(['settlement', 'settle', 'transfer', 'payment', 'settleup']);
const SUMMARY_ROW = /^(grand\s+|sub\s*)?total\b/i;

interface Ctx {
  book: NameBook;
  currency: CurrencyCode;
  style: DecimalStyle;
  line: number;
  key: string;
}

function parseSplitCell(
  text: string,
  amount: bigint,
  ctx: Ctx,
): { split: DraftSplit | null; issues: ImportIssue[] } {
  const trimmed = text.trim();
  if (trimmed === '' || EVERYONE.test(trimmed)) {
    return { split: { kind: 'equal', among: 'everyone' }, issues: [] };
  }
  const bad = (
    code: ImportProblemKind,
    message: string,
  ): { split: null; issues: ImportIssue[] } => ({
    split: null,
    issues: [issueOf('error', code, 'split', `Row ${ctx.line}: ${message}`)],
  });

  const pairs = trimmed
    .split(SPLIT_SEPARATORS)
    .map((token) => token.trim())
    .filter((token) => token !== '')
    .map((token) => {
      const at = token.lastIndexOf(':');
      return at < 0
        ? { name: ctx.book.add(token), value: null }
        : { name: ctx.book.add(token.slice(0, at)), value: token.slice(at + 1).trim() };
    });
  if (pairs.some((pair) => pair.name === null)) {
    return bad(ImportProblemKind.UnparseableRow, 'could not read who the cost is split between.');
  }
  const names = pairs.map((pair) => pair.name!);
  if (new Set(names).size !== names.length) {
    return bad(ImportProblemKind.UnparseableRow, 'a name appears twice in the split.');
  }

  const valued = pairs.filter((pair) => pair.value !== null);
  if (valued.length === 0) return { split: { kind: 'equal', among: names }, issues: [] };
  if (valued.length !== pairs.length) {
    return bad(
      ImportProblemKind.UnparseableRow,
      'some names in the split have an amount and some do not.',
    );
  }

  if (valued.every((pair) => pair.value!.endsWith('%'))) {
    const basisPoints: Record<string, number> = nameMap();
    for (const pair of valued) {
      const number = pair.value!.slice(0, -1).trim();
      if (!/^\d+(\.\d{1,2})?$/.test(number)) {
        return bad(
          ImportProblemKind.UnparseableRow,
          `could not read "${pair.value}" as a percentage.`,
        );
      }
      basisPoints[pair.name!] = Math.round(Number(number) * 100);
    }
    if (Object.values(basisPoints).reduce((total, value) => total + value, 0) !== 10000) {
      return bad(ImportProblemKind.PercentNot100, 'the percentages do not add up to 100.');
    }
    return { split: { kind: 'percent', basisPoints }, issues: [] };
  }

  const exact: Record<string, bigint> = nameMap();
  let exactOk = true;
  for (const pair of valued) {
    const parsed = parseLooseAmount(pair.value!, ctx.currency, ctx.style);
    if (!parsed.ok || parsed.minor < 0n) exactOk = false;
    else exact[pair.name!] = parsed.minor;
  }
  if (exactOk && sumOf(exact) === amount)
    return { split: { kind: 'exact', amounts: exact }, issues: [] };

  if (valued.every((pair) => /^\d+(\.\d{1,2})?$/.test(pair.value!))) {
    const weights = Object.fromEntries(valued.map((pair) => [pair.name!, Number(pair.value)]));
    if (Object.values(weights).some((weight) => weight > 0)) {
      return {
        split: { kind: 'shares', weights },
        issues: [
          issueOf(
            'warning',
            ImportProblemKind.SplitDoesNotAddUp,
            'split',
            `Row ${ctx.line}: the amounts in the split do not add up to the cost, so they were read as shares.`,
          ),
        ],
      };
    }
  }
  return bad(
    ImportProblemKind.SplitDoesNotAddUp,
    'the amounts in the split do not add up to the cost.',
  );
}

function parsePayerCell(
  text: string,
  amount: bigint,
  ctx: Ctx,
): { payers: DraftPayers; issues: ImportIssue[] } {
  const trimmed = text.trim();
  if (trimmed === '') return { payers: null, issues: [] };

  if (trimmed.includes(':')) {
    const payers: Record<string, bigint> = nameMap();
    for (const token of trimmed.split(PAYER_SEPARATORS)) {
      const at = token.lastIndexOf(':');
      const name = at < 0 ? null : ctx.book.add(token.slice(0, at));
      const parsed = at < 0 ? null : parseLooseAmount(token.slice(at + 1), ctx.currency, ctx.style);
      if (!name || !parsed?.ok || parsed.minor <= 0n) {
        return {
          payers: null,
          issues: [
            issueOf(
              'error',
              ImportProblemKind.UnparseableRow,
              'payers',
              `Row ${ctx.line}: could not read who paid how much.`,
            ),
          ],
        };
      }
      payers[name] = (payers[name] ?? 0n) + parsed.minor;
    }
    if (sumOf(payers) !== amount) {
      return {
        payers: null,
        issues: [
          issueOf(
            'error',
            ImportProblemKind.SplitDoesNotAddUp,
            'payers',
            `Row ${ctx.line}: what was paid does not add up to the cost.`,
          ),
        ],
      };
    }
    return { payers, issues: [] };
  }

  const names = [
    ...new Set(
      trimmed
        .split(PAYER_SEPARATORS)
        .map((name) => ctx.book.add(name))
        .filter((name): name is string => name !== null),
    ),
  ];
  if (names.length === 1) return { payers: { single: names[0]! }, issues: [] };
  return {
    payers: equalPayers(amount, names, ctx.key),
    issues: [
      issueOf(
        'warning',
        ImportProblemKind.PayerEstimated,
        'payers',
        `Row ${ctx.line}: several people paid with no amounts, so the cost was split between them equally.`,
      ),
    ],
  };
}

/**
 * Read a spreadsheet-shaped file with the layout `detectLayout` found (or one
 * the person corrected). Dispatches to the Splitwise and Waves readers when the
 * layout is theirs.
 */
export function draftFromTable(
  table: TableRead,
  layout: DetectedLayout,
  options: DraftOptions = {},
): ImportDraft {
  if (layout.kind === 'splitwise') return draftFromSplitwiseTable(table, options);
  if (layout.kind === 'waves_csv') return draftFromWavesTable(table, options);

  const fileDraft = (problem: ImportProblem): ImportDraft => ({
    source: 'csv',
    people: [],
    rows: [],
    fileProblems: [problem],
    detected: layout,
  });
  if (
    layout.headerRow < 0 ||
    (layout.columns.amount === undefined && layout.personColumns.length === 0)
  ) {
    return fileDraft({
      kind: ImportProblemKind.NotAnExport,
      row: null,
      message: 'Could not find the date, description and amount columns.',
    });
  }
  const data = table.rows.slice(layout.headerRow + 1);
  if (data.length > MAX_IMPORT_ROWS) {
    return fileDraft({
      kind: ImportProblemKind.TooManyRows,
      row: null,
      message: `This file has ${data.length} rows; the limit is ${MAX_IMPORT_ROWS}.`,
    });
  }

  const col = layout.columns;
  const cell = (row: readonly string[], field: keyof typeof col): string =>
    col[field] === undefined ? '' : (row[col[field]!] ?? '');
  const dates = resolveDates(
    data.map((row) => cell(row, 'date')),
    {
      country: options.country,
      allowSerial: true,
      today: options.today,
      order: layout.dateOrder ?? undefined,
    },
  );
  const book = new NameBook();
  const fallback = options.defaultCurrency ?? 'INR';
  const rows: ImportDraftRow[] = [];

  data.forEach((fields, offset) => {
    const line = table.lines[layout.headerRow + 1 + offset] ?? offset + 1;
    const description = cell(fields, 'description');
    const dateText = cell(fields, 'date');
    if (dateText === '' && SUMMARY_ROW.test(description)) return;

    const typeText = cell(fields, 'type');
    const isSettlement = SETTLEMENT_TYPES.has(typeText.toLowerCase().replace(/[^a-z]/g, ''));
    const rawCategory = cell(fields, 'category') || (isSettlement ? '' : typeText) || null;
    const shown = description || (isSettlement ? 'Payment' : 'Imported expense');

    const currencyText = cell(fields, 'currency').toUpperCase();
    if (currencyText !== '' && !isCurrencyCode(currencyText)) {
      rows.push(
        failure('csv', line, shown, [
          issueOf(
            'error',
            ImportProblemKind.UnknownCurrency,
            'currency',
            `Row ${line}: "${currencyText}" is not a currency code.`,
          ),
        ]),
      );
      return;
    }
    const hint: CurrencyCode = currencyText || fallback;
    const ctx: Ctx = { book, currency: hint, style: layout.decimalStyle, line, key: `csv:${line}` };

    const wide = layout.personColumns.map((entry) => ({ entry, text: fields[entry.column] ?? '' }));
    const amountText = cell(fields, 'amount');
    const cost = parseLooseAmount(amountText, hint, layout.decimalStyle);
    const dateProblem = dateIssue(dates.cells[offset], line);

    const stop = (issue: ImportIssue): void => {
      rows.push(
        failure('csv', line, shown, [issue], {
          rawCategory,
          currency: currencyText || (cost.ok ? cost.currency : null) || null,
          date: dates.cells[offset]?.iso ?? null,
        }),
      );
    };
    if (dateProblem) return stop(dateProblem);
    if (!cost.ok) return stop(amountIssue(cost.reason, line, hint, amountText));
    if (cost.minor < 0n) {
      return stop(
        issueOf(
          'error',
          ImportProblemKind.RefundNotSupported,
          'amount',
          `Row ${line}: refunds are not supported yet; remove the minus sign to import this as an expense.`,
        ),
      );
    }
    if (cost.minor === 0n) {
      return stop(
        issueOf(
          'error',
          ImportProblemKind.NonPositiveCost,
          'amount',
          `Row ${line}: the cost must be greater than zero.`,
        ),
      );
    }
    const amount = cost.minor;
    const currency = (currencyText || cost.currency || null) as CurrencyCode | null;
    const date = dates.cells[offset]!.iso;
    const issues: ImportIssue[] = [];

    if (isSettlement) {
      const from = book.add(cell(fields, 'paid_by'));
      const to = book.add(
        cell(fields, 'owed_by') || cell(fields, 'split').split(SPLIT_SEPARATORS)[0] || '',
      );
      if (!from || !to || from === to) {
        return stop(
          issueOf(
            'error',
            ImportProblemKind.UnexpectedSettlement,
            'settlement',
            `Row ${line}: a payment needs one person paying a different person.`,
          ),
        );
      }
      rows.push({
        ...emptyRow('csv', line, line, 'settlement'),
        date,
        description: shown,
        category: null,
        rawCategory: null,
        currency,
        amount,
        payers: null,
        split: null,
        settlement: { from, to },
        issues,
      });
      return;
    }

    const payer = parsePayerCell(cell(fields, 'paid_by'), amount, ctx);
    issues.push(...payer.issues);
    if (payer.issues.some((found) => found.severity === 'error')) return stop(payer.issues[0]!);

    let split: DraftSplit | null;
    const filled = wide.filter((person) => person.text !== '');
    if (cell(fields, 'split') === '' && filled.length > 0) {
      const values: Record<string, bigint> = nameMap();
      let readable = true;
      for (const person of filled) {
        const parsed = parseLooseAmount(person.text, hint, layout.decimalStyle);
        if (!parsed.ok) readable = false;
        else values[book.add(person.entry.name)!] = parsed.minor;
      }
      const total = sumOf(values);
      const unsigned = Object.values(values).every((value) => value >= 0n);
      if (!readable) {
        return stop(
          issueOf(
            'error',
            ImportProblemKind.UnparseableRow,
            'split',
            `Row ${line}: could not read a person's amount.`,
          ),
        );
      }
      if (unsigned && total === amount) split = { kind: 'exact', amounts: values };
      else if (total === 0n) split = { kind: 'net', nets: values };
      else {
        return stop(
          issueOf(
            'error',
            ImportProblemKind.RowDoesNotBalance,
            'split',
            `Row ${line}: the people's columns add up to neither the cost nor zero.`,
          ),
        );
      }
    } else {
      const parsed = parseSplitCell(cell(fields, 'split'), amount, ctx);
      issues.push(...parsed.issues);
      if (parsed.issues.some((found) => found.severity === 'error'))
        return stop(parsed.issues.find((found) => found.severity === 'error')!);
      split = parsed.split;
    }

    rows.push({
      ...emptyRow('csv', line, line, 'expense'),
      date,
      description: shown,
      category: categoryFor(rawCategory, shown, options.country),
      rawCategory,
      currency,
      amount,
      payers: payer.payers,
      split,
      issues,
    });
  });

  return {
    source: 'csv',
    people: book.names,
    rows,
    fileProblems:
      rows.length === 0
        ? [
            {
              kind: ImportProblemKind.NoRows,
              row: null,
              message: 'There were no expenses in this file.',
            },
          ]
        : [],
    detected: layout,
  };
}

/** Never throws: the first thing a screen does with a freshly read file. */
export function draftFromText(
  text: string,
  options: DraftOptions & { members?: readonly string[] } = {},
): ImportDraft {
  const table = readTable(text);
  const layout = detectLayout(table, options);
  return draftFromTable(table, layout, options);
}
