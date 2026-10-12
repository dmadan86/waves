/**
 * Bringing a Splitwise group across (TDR §10, M3).
 *
 * The acceptance bar is "CSV round-trips into correct balances", and the word
 * doing the work is *balances*. A Splitwise export does not contain enough to
 * reconstruct an expense exactly: each person's column is their **net** for
 * that row — what they paid minus what they owed — and many different
 * (paid, owed) pairs produce the same net.
 *
 * So this module is honest about what it can and cannot recover:
 *
 *   - balances are exact, to the paisa, and that is provable;
 *   - who paid is a *reconstruction* chosen deterministically, not the truth
 *     from the original group. Anyone whose net was positive is treated as
 *     having paid, in proportion to that net.
 *
 * Pretending otherwise would be the worse failure: an import that silently
 * invents a single payer would show a history that never happened, and the
 * person reading it has no way to tell.
 *
 * Amounts are parsed digit by digit. A CSV of somebody's entire financial
 * history is precisely where a float would quietly lose a paisa per row and
 * only show up as a balance that will not settle (ADR-003).
 *
 * The reading itself lives in `draft.ts` and `resolve.ts`, shared with every
 * other import source; this file keeps the long-standing `importSplitwiseCsv`
 * shape for the screens and scripts that already use it.
 */

import { minorUnitExponent, type CurrencyCode } from '../money/currency';
import type { ExactParams } from '../split/types';
import { draftFromSplitwise, draftProblems, type DraftOptions } from './draft';
import type { ImportProblem } from './problem';
import { resolveDraft } from './resolve';
import type { WavesImportSettlement } from './waves';

export interface ImportedExpense {
  readonly description: string;
  readonly category: string | null;
  /** ISO date, YYYY-MM-DD. */
  readonly date: string;
  readonly currency: CurrencyCode;
  /** Total, in minor units. */
  readonly amount: bigint;
  /** Reconstructed: who is treated as having paid, and how much. Sums to `amount`. */
  readonly payers: Readonly<Record<string, bigint>>;
  /** Exactly what each person owed. Sums to `amount`. */
  readonly shares: Readonly<Record<string, bigint>>;
  /** Ready to hand to the write path unchanged. */
  readonly splitParams: ExactParams;
}

export interface SplitwiseImport {
  /** Everybody named in the file, in column order. */
  readonly people: readonly string[];
  readonly expenses: readonly ImportedExpense[];
  /** `Payment` rows: somebody settling up with somebody, not a shared cost. */
  readonly settlements: readonly WavesImportSettlement[];
  /** Net position per person, in minor units. Sums to zero. */
  readonly balances: Readonly<Record<string, bigint>>;
  readonly currency: CurrencyCode;
  /** Rows that could not be imported. Everything else still is. */
  readonly problems: readonly ImportProblem[];
}

/**
 * A CSV parser that handles the only two things that actually appear in these
 * files: quoted fields, and commas inside them. A description of
 * `Dinner, drinks and a taxi` is common enough that splitting on commas would
 * corrupt real files.
 */
export function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is an escaped quote.
        if (line[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      fields.push(field);
      field = '';
    } else field += char;
  }
  fields.push(field);
  return fields.map((value) => value.trim());
}

/**
 * "-1,234.56" → -123456 minor units, by digits. Returns null for anything that
 * is not a number, which is how a blank person-column is told apart from zero.
 */
export function parseCsvAmount(text: string, currency: CurrencyCode): bigint | null {
  const cleaned = text.trim().replace(/,/g, '').replace(/^\+/, '');
  if (cleaned === '') return null;
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(cleaned);
  if (!match) return null;

  const exponent = minorUnitExponent(currency);
  const fraction = (match[3] ?? '') + '0'.repeat(exponent);
  const minor = BigInt((match[2] ?? '0') + fraction.slice(0, exponent));
  return match[1] === '-' ? -minor : minor;
}

/**
 * Read a Splitwise CSV export.
 *
 * Never throws. A file with three bad rows and forty good ones imports the
 * forty and names the three — refusing the lot because one row is malformed
 * would be the wrong trade for somebody moving years of history.
 *
 * A `Payment` row comes back as a settlement, never an expense. Balances count
 * both.
 */
export function importSplitwiseCsv(csv: string, options: DraftOptions = {}): SplitwiseImport {
  const draft = draftFromSplitwise(csv, options);
  const resolved = resolveDraft(draft, {}, { groupCurrency: 'INR', members: [] });
  const rawCategory = new Map(draft.rows.map((row) => [row.key, row.rawCategory]));

  const problems: ImportProblem[] = draftProblems(draft);
  // Rows the draft accepted but resolution refused (never expected for a Splitwise file).
  for (const { row, issues } of resolved.rejected) {
    for (const issue of issues.slice(row.issues.length)) {
      if (issue.severity === 'error') {
        problems.push({ kind: issue.code, row: row.row, message: issue.message });
      }
    }
  }
  problems.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));

  const expenses: ImportedExpense[] = [];
  const settlements: WavesImportSettlement[] = [];
  const balances = new Map<string, bigint>(draft.people.map((person) => [person, 0n]));
  for (const row of resolved.rows) {
    if (row.kind === 'expense') {
      expenses.push({
        description: row.description,
        category: rawCategory.get(row.key) ?? null,
        date: row.date,
        currency: row.currency,
        amount: row.amount,
        payers: row.payers,
        shares: row.shares,
        splitParams: row.splitParams,
      });
    } else {
      settlements.push({
        from: row.from,
        to: row.to,
        currency: row.currency,
        amount: row.amount,
        method: 'other',
        status: 'confirmed',
        note: row.description,
        at: row.date,
      });
    }
  }
  for (const book of Object.values(resolved.balances)) {
    for (const [person, value] of Object.entries(book)) {
      balances.set(person, (balances.get(person) ?? 0n) + value);
    }
  }

  const currency =
    [...draft.rows].reverse().find((row) => row.currency !== null)?.currency ?? 'INR';
  return {
    people: draft.people,
    expenses,
    settlements,
    balances: Object.fromEntries(balances),
    currency,
    problems,
  };
}
