/**
 * From statement rows to what Review should show, and what it should not.
 *
 * A statement arrives after the bank's SMS did, so most of its debits are
 * already in Review (as drafts) or on the ledger (as expenses). Importing it
 * must never double them. In order:
 *
 *   1. **Merge with SMS drafts.** The statement's UPI/NEFT reference is the same
 *      string the bank's SMS carried, and the SMS dedupe key is `ref:<REF>`. A
 *      statement row with that key does not become a second draft: it enriches
 *      the one that is there (`merged_sms`).
 *   2. **Within the file.** The same reference twice is the same transaction
 *      (an overlapping page, a repeated chunk). Two identical coffees with no
 *      reference and different balances are two coffees, and stay.
 *   3. **Against the ledger.** `findDuplicates` over debits: same day, amount and
 *      wording is `likely` (unticked), close is `possible` (ticked, warned).
 *
 * Nothing is posted here. Every kept row is a Review draft the person confirms.
 */

import { findDuplicates, type DedupeRow, type ExistingExpense } from '../import/dedupe';
import type { StatementRow, StatementRowWarning } from './types';

export type StatementItemStatus =
  'new' | 'merged_sms' | 'duplicate_in_file' | 'likely_duplicate' | 'possible_duplicate';

export interface StatementItem {
  /** The Review draft's dedupe key. `ref:<REF>` when the row has a reference. */
  readonly key: string;
  readonly row: StatementRow;
  readonly status: StatementItemStatus;
  /** Debits only, and only the ones nothing doubts. */
  readonly ticked: boolean;
  /** Money out is spending; money in is shown apart, unticked. */
  readonly section: 'out' | 'in';
  /** For `merged_sms`: the SMS draft's key (equal to `key`). */
  readonly mergeInto: string | null;
  /** For a ledger duplicate: the expense it resembles. */
  readonly duplicateOf: string | null;
  /** Why it is unticked or flagged, for the row's note. */
  readonly flags: readonly StatementRowWarning[];
}

export interface StatementPlanSummary {
  /** Rows that become Review drafts. */
  readonly added: number;
  /** Rows folded into an SMS draft that was already there. */
  readonly merged: number;
  /** Rows dropped as the same transaction twice in the file. */
  readonly inFile: number;
  /** `merged + inFile`: the "M duplicates skipped" of the summary line. */
  readonly duplicatesSkipped: number;
  readonly moneyOut: number;
  readonly moneyIn: number;
  /** Sum of debit amounts that were added, minor units. */
  readonly spentMinor: bigint;
}

export interface StatementPlan {
  readonly items: readonly StatementItem[];
  readonly summary: StatementPlanSummary;
}

export interface PlanOptions {
  /** Dedupe keys of drafts already in Review (SMS and earlier statement imports). */
  readonly draftKeys?: ReadonlySet<string>;
  /** The ledger's current expenses, for the duplicate check. */
  readonly existing?: readonly ExistingExpense[];
  readonly currency: string;
}

const norm = (text: string): string =>
  text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

/**
 * The dedupe key a statement row gives its draft. A reference keys exactly as
 * the SMS parser does, so the two collide on purpose. Without one, the key is
 * the row's own content plus its place among identical rows.
 */
export function statementDedupeKey(row: StatementRow, occurrence = 0): string {
  if (row.ref) return `ref:${row.ref.toUpperCase()}`;
  return `stmt:${row.date ?? 'undated'}:${row.direction}:${row.amount}:${norm(row.description).slice(0, 40)}:${occurrence}`;
}

/** Warnings that stop a row being ticked on its own. */
const DOUBTS: readonly StatementRowWarning[] = [
  'balance_mismatch',
  'low_confidence',
  'bad_date',
  'zero_amount',
];

export function planStatementImport(
  rows: readonly StatementRow[],
  options: PlanOptions,
): StatementPlan {
  const draftKeys = options.draftKeys ?? new Set<string>();

  // Keys, with a running count so identical reference-less rows stay distinct.
  const seenContent = new Map<string, number>();
  const keyed = rows.map((row) => {
    const base = statementDedupeKey(row, 0);
    const n = seenContent.get(base) ?? 0;
    seenContent.set(base, n + 1);
    return { row, key: row.ref ? base : statementDedupeKey(row, n) };
  });

  // Ledger duplicates, over debits that have a real date.
  const comparable: DedupeRow[] = keyed.flatMap(({ row, key }) =>
    row.direction === 'debit' && row.date
      ? [
          {
            key,
            date: row.date,
            currency: options.currency,
            amount: BigInt(row.amount),
            description: row.description,
          },
        ]
      : [],
  );
  const report = findDuplicates(comparable, options.existing ?? []);

  const firstRefSeen = new Set<string>();
  const firstBalanceSeen = new Set<string>();
  const items: StatementItem[] = [];
  let merged = 0;
  let inFile = 0;

  for (const { row, key } of keyed) {
    const section = row.direction === 'debit' ? 'out' : 'in';
    const flags = row.warnings.filter((w) => DOUBTS.includes(w));

    // Within the file first: the same transaction twice must not merge twice.
    const refSig = row.ref ? `${row.ref}:${row.direction}:${row.amount}` : null;
    const balSig =
      row.balance !== null
        ? `${row.date}:${row.direction}:${row.amount}:${row.balance}:${norm(row.description)}`
        : null;
    if ((refSig && firstRefSeen.has(refSig)) || (balSig && firstBalanceSeen.has(balSig))) {
      inFile += 1;
      items.push({
        key,
        row,
        status: 'duplicate_in_file',
        ticked: false,
        section,
        mergeInto: null,
        duplicateOf: null,
        flags,
      });
      continue;
    }
    if (refSig) firstRefSeen.add(refSig);
    if (balSig) firstBalanceSeen.add(balSig);

    if (row.ref && draftKeys.has(key)) {
      merged += 1;
      items.push({
        key,
        row,
        status: 'merged_sms',
        ticked: false,
        section,
        mergeInto: key,
        duplicateOf: null,
        flags,
      });
      continue;
    }

    const match = report.existing.get(key);
    const status: StatementItemStatus = match
      ? match.level === 'likely'
        ? 'likely_duplicate'
        : 'possible_duplicate'
      : 'new';
    items.push({
      key,
      row,
      status,
      ticked: section === 'out' && flags.length === 0 && status !== 'likely_duplicate',
      section,
      mergeInto: null,
      duplicateOf: match?.expenseId ?? null,
      flags,
    });
  }

  const kept = items.filter((i) => i.status !== 'merged_sms' && i.status !== 'duplicate_in_file');
  return {
    items,
    summary: {
      added: kept.length,
      merged,
      inFile,
      duplicatesSkipped: merged + inFile,
      moneyOut: kept.filter((i) => i.section === 'out').length,
      moneyIn: kept.filter((i) => i.section === 'in').length,
      spentMinor: kept
        .filter((i) => i.section === 'out')
        .reduce((sum, i) => sum + BigInt(i.row.amount), 0n),
    },
  };
}

export interface StatementPreview {
  /** Every transaction in the file, in and out. */
  readonly count: number;
  readonly spentMinor: bigint;
  /** The first three rows of the file, for the Free teaser. */
  readonly first: readonly StatementRow[];
}

/** The Free teaser: "N transactions · ₹X spent" and the first three rows. */
export function previewStatement(rows: readonly StatementRow[]): StatementPreview {
  return {
    count: rows.length,
    spentMinor: rows
      .filter((r) => r.direction === 'debit')
      .reduce((sum, r) => sum + BigInt(r.amount), 0n),
    first: rows.slice(0, 3),
  };
}
