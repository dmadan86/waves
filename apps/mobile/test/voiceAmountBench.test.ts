/**
 * The spoken-amount bench: how people say money, scored end to end.
 *
 * `fixtures/voice-amounts.json` holds a few hundred phrasings — plain and Indian
 * English, lakh and crore, decimals, cents and paise, "each" against "total",
 * self-corrections ("fifteen sorry fifty"), Hindi, Tamil and Arabic number words
 * in the Latin spellings recognisers return, n-best alternatives that disagree
 * ("fifteen" / "fifty"), a bare "dollars" in and out of a dollar group — and
 * sentences whose numbers are a date, a time, a count or a label and must never
 * become an amount ("5th of October", "at 7", "table for two", "flight 302").
 *
 * Every case runs through `parseVoiceExpenses`, the path the review screen uses.
 * The scores that matter:
 *
 * - exact: the amount read is the amount meant (minor units, exact);
 * - wrong without a flag: an amount was read, it is not the one meant, and the
 *   screen was not told to ask — the outcome that costs someone money;
 * - false amount: a negative sentence produced an expense at all.
 *
 * Deterministic: no clock beyond a fixed `now`, no randomness, no network.
 * VOICE_BENCH_VERBOSE=1 lists every miss.
 */

import { describe, expect, it } from 'vitest';

import { parseVoiceExpenses, type VoiceGroupRef } from '@/lib/voiceExpense';

import fixture from './fixtures/voice-amounts.json';

interface BenchCase {
  readonly say: string;
  /** Minor units meant, or null for a sentence with no amount in it. */
  readonly minor: string | null;
  readonly role: string;
  readonly ambiguity: string;
  readonly lang: string;
  readonly tag: string;
  readonly currency?: string;
  readonly alts?: readonly string[];
  /** The currency of the group the mic was opened in, when there is one. */
  readonly group?: string;
}

const CASES = (fixture as { cases: BenchCase[] }).cases;

const VERBOSE = Boolean(
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
    .VOICE_BENCH_VERBOSE,
);

const AMOUNT_FLAGS = new Set(['decimal-or-hundreds', 'teen-vs-ty', 'total-or-each']);

interface Outcome {
  readonly exact: boolean;
  readonly miss: boolean;
  readonly wrongUnflagged: boolean;
  readonly falseAmount: boolean;
  readonly ambiguityRight: boolean;
  readonly roleRight: boolean;
  readonly currencyRight: boolean;
  readonly got: string;
}

function judge(row: BenchCase): Outcome {
  const groups: VoiceGroupRef[] = row.group ? [{ id: 'g', name: 'Trip', currency: row.group }] : [];
  const result = parseVoiceExpenses(row.say, groups, {
    currentGroupId: row.group ? 'g' : null,
    now: new Date(2026, 9, 7, 12),
    alternatives: row.alts,
  });
  // Older parsers carry no reading; treat that as "never asks".
  const reading = (result as { amount?: { ambiguity?: string; role?: string | null } | null })
    .amount;
  const ambiguity = reading?.ambiguity ?? 'none';
  const role = reading?.role ?? 'total';
  const [first] = result.items;
  const got = result.items.length === 1 && first ? first.amountMinor.toString() : null;
  const got_ = result.items.map((item) => `${item.amountMinor}${item.currency ?? ''}`).join('+');

  if (row.minor === null) {
    return {
      exact: false,
      miss: false,
      wrongUnflagged: false,
      falseAmount: result.items.length > 0,
      ambiguityRight: true,
      roleRight: true,
      currencyRight: true,
      got: got_ || '-',
    };
  }
  const exact = got === row.minor;
  const flagged = AMOUNT_FLAGS.has(ambiguity);
  return {
    exact,
    miss: result.items.length === 0,
    wrongUnflagged: result.items.length > 0 && !exact && !flagged,
    falseAmount: false,
    ambiguityRight: ambiguity === row.ambiguity,
    roleRight: role === row.role,
    currencyRight: row.currency === undefined || first?.currency === row.currency,
    got: `${got_ || '-'} ${ambiguity}/${role}`,
  };
}

/** Ratchets: raise the floors and lower the ceilings as the parser improves. */
const EXACT_FLOOR = 0.95;
const WRONG_UNFLAGGED_CEILING = 0.01;
const FALSE_AMOUNT_CEILING = 0.04;
const AMBIGUITY_FLOOR = 0.95;

const pct = (part: number, whole: number): string =>
  `${((100 * part) / Math.max(whole, 1)).toFixed(1)}%`;

describe('spoken-amount bench', () => {
  const positives = CASES.filter((row) => row.minor !== null);
  const negatives = CASES.filter((row) => row.minor === null);
  const outcomes = new Map(CASES.map((row) => [row, judge(row)] as const));
  const count = (rows: readonly BenchCase[], key: keyof Outcome): number =>
    rows.filter((row) => outcomes.get(row)?.[key] === true).length;

  it('reports exact, wrong-without-flag and false-amount rates', () => {
    const tags = [...new Set(CASES.map((row) => row.tag))];
    const lines = tags.map((tag) => {
      const rows = CASES.filter((row) => row.tag === tag);
      const pos = rows.filter((row) => row.minor !== null);
      const neg = rows.filter((row) => row.minor === null);
      return `${tag.padEnd(22)} n=${String(rows.length).padStart(3)}  exact ${pct(count(pos, 'exact'), pos.length).padStart(6)}  wrong-unflagged ${pct(count(pos, 'wrongUnflagged'), pos.length).padStart(6)}  false-amount ${pct(count(neg, 'falseAmount'), neg.length).padStart(6)}`;
    });
    lines.push(
      `${'all'.padEnd(22)} n=${String(CASES.length).padStart(3)}  exact ${pct(count(positives, 'exact'), positives.length)}  wrong-unflagged ${pct(count(positives, 'wrongUnflagged'), positives.length)}  false-amount ${pct(count(negatives, 'falseAmount'), negatives.length)}  ambiguity ${pct(count(positives, 'ambiguityRight'), positives.length)}  role ${pct(count(positives, 'roleRight'), positives.length)}  currency ${pct(count(positives, 'currencyRight'), positives.length)}`,
    );
    if (VERBOSE)
      for (const row of CASES) {
        const outcome = outcomes.get(row);
        if (!outcome) continue;
        const bad =
          outcome.falseAmount ||
          (row.minor !== null &&
            (!outcome.exact ||
              !outcome.ambiguityRight ||
              !outcome.roleRight ||
              !outcome.currencyRight));
        if (bad)
          lines.push(
            `  [${row.tag}] "${row.say}" want ${row.minor ?? '-'}${row.currency ?? ''} ${row.ambiguity}/${row.role} got ${outcome.got}`,
          );
      }
    console.log(lines.join('\n'));
    expect(CASES.length).toBeGreaterThanOrEqual(300);
  });

  it('reads the amount meant', () => {
    expect(count(positives, 'exact') / positives.length).toBeGreaterThanOrEqual(EXACT_FLOOR);
  });

  it('almost never reads a wrong amount without asking', () => {
    expect(count(positives, 'wrongUnflagged') / positives.length).toBeLessThanOrEqual(
      WRONG_UNFLAGGED_CEILING,
    );
  });

  it('almost never finds an amount in a sentence without one', () => {
    expect(count(negatives, 'falseAmount') / negatives.length).toBeLessThanOrEqual(
      FALSE_AMOUNT_CEILING,
    );
  });

  it('asks exactly when the amount is in doubt', () => {
    expect(count(positives, 'ambiguityRight') / positives.length).toBeGreaterThanOrEqual(
      AMBIGUITY_FLOOR,
    );
  });
});
