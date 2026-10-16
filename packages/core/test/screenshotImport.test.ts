/**
 * Screenshot import pins: what the model returns is checked, never trusted.
 * Bad rows are dropped and counted, summaries never reach the review list,
 * sums that do not add up are flagged, and names are only ever suggestions.
 */

import { describe, expect, it } from 'vitest';

import { CategoryId } from '../src/category/categories';
import {
  PRO_MONTHLY_SCREENSHOT_IMPORTS,
  suggestMember,
  validateScreenshotExtraction,
} from '../src';

const row = (over: Record<string, unknown> = {}) => ({
  date: '2026-10-12',
  dateText: '12 Oct',
  description: 'Dinner at Toit',
  amountMinor: 120000,
  currency: null,
  direction: 'spent',
  paidBy: null,
  splitAmong: [],
  perPerson: [],
  category: null,
  confidence: 0.9,
  isTotalOrSummary: false,
  ...over,
});

const wrap = (rows: unknown[], over: Record<string, unknown> = {}) => ({
  imageKind: 'expense_list',
  currency: 'INR',
  rows,
  ...over,
});

function run(raw: unknown, options = {}) {
  const result = validateScreenshotExtraction(raw, options);
  if (!result.ok) throw new Error('expected ok');
  return result.extraction;
}

describe('plan constants', () => {
  it('match the plan', () => {
    expect(PRO_MONTHLY_SCREENSHOT_IMPORTS).toBe(100);
  });
});

describe('validateScreenshotExtraction', () => {
  it('refuses anything that is not an object with a rows array', () => {
    for (const bad of [null, 'x', 4, [], {}, { rows: 'no' }]) {
      expect(validateScreenshotExtraction(bad)).toEqual({ ok: false, reason: 'malformed' });
    }
  });

  it('passes a clean row through', () => {
    const out = run(wrap([row()]));
    expect(out.imageKind).toBe('expense_list');
    expect(out.currency).toBe('INR');
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({
      index: 0,
      date: '2026-10-12',
      description: 'Dinner at Toit',
      amountMinor: 120000,
      direction: 'spent',
      category: CategoryId.Food,
      warnings: [],
    });
    expect(out.warnings).toEqual([]);
  });

  it('drops rows with no description or a non-integer, negative or unsafe amount', () => {
    const out = run(
      wrap([
        row({ description: '  ' }),
        row({ amountMinor: 12.5 }),
        row({ amountMinor: -3 }),
        row({ amountMinor: Number.MAX_SAFE_INTEGER + 2 }),
        row({ amountMinor: '100' }),
        'junk',
        row({ description: 'Cab', amountMinor: 5000 }),
      ]),
    );
    expect(out.rows.map((r) => r.description)).toEqual(['Cab']);
    expect(out.rows[0]!.index).toBe(6);
    expect(out.warnings).toContainEqual({ code: 'rows_dropped_invalid', count: 6 });
  });

  it('never lets totals, balances or summaries through, and counts them', () => {
    const out = run(wrap([row(), row({ description: 'Total', isTotalOrSummary: true })]));
    expect(out.rows).toHaveLength(1);
    expect(out.warnings).toContainEqual({ code: 'summary_rows_dropped', count: 1 });
  });

  it('says so when nothing is left', () => {
    expect(run(wrap([])).warnings).toEqual([{ code: 'no_rows', count: 0 }]);
  });

  it('nulls an impossible date and flags it, keeping the printed text', () => {
    const out = run(wrap([row({ date: '2026-02-30' }), row({ date: 'yesterday' })]));
    expect(out.rows[0]).toMatchObject({ date: null, dateText: '12 Oct' });
    expect(out.rows[0]!.warnings).toContain('bad_date');
    expect(out.rows[1]!.warnings).toContain('bad_date');
    expect(run(wrap([row({ date: null })])).rows[0]!.warnings).not.toContain('bad_date');
  });

  it('accepts a leap day', () => {
    expect(run(wrap([row({ date: '2028-02-29' })])).rows[0]!.date).toBe('2028-02-29');
  });

  it('normalises currency codes and flags bad ones', () => {
    const out = run(wrap([row({ currency: 'usd' }), row({ currency: 'rupees' })]));
    expect(out.rows[0]!.currency).toBe('USD');
    expect(out.rows[1]!.currency).toBeNull();
    expect(out.rows[1]!.warnings).toContain('bad_currency');
    expect(run(wrap([], { currency: 'dollars' })).currency).toBeNull();
  });

  it('flags a zero amount, credits and transfers', () => {
    const out = run(
      wrap([
        row({ amountMinor: 0 }),
        row({ direction: 'received' }),
        row({ direction: 'transfer' }),
        row({ direction: 'sideways' }),
      ]),
    );
    expect(out.rows[0]!.warnings).toContain('zero_amount');
    expect(out.rows[1]!.warnings).toContain('credit_or_transfer');
    expect(out.rows[2]!.warnings).toContain('credit_or_transfer');
    expect(out.rows[3]!.direction).toBe('unknown');
  });

  it('flags per-person amounts that do not add up to the total, and not ones that do', () => {
    const good = row({
      amountMinor: 1000,
      perPerson: [
        { name: 'Asha', amountMinor: 400 },
        { name: 'Ravi', amountMinor: 600 },
      ],
    });
    const bad = row({
      amountMinor: 1000,
      perPerson: [
        { name: 'Asha', amountMinor: 400 },
        { name: 'Ravi', amountMinor: 500 },
      ],
    });
    const out = run(wrap([good, bad]));
    expect(out.rows[0]!.warnings).not.toContain('split_sum_mismatch');
    expect(out.rows[1]!.warnings).toContain('split_sum_mismatch');
    // Transcribed as printed, never "corrected".
    expect(out.rows[1]!.perPerson.map((p) => p.amountMinor)).toEqual([400, 500]);
  });

  it('clamps confidence and starts low-confidence rows flagged', () => {
    const out = run(
      wrap([row({ confidence: 4 }), row({ confidence: 0.3 }), row({ confidence: 'high' })]),
    );
    expect(out.rows.map((r) => r.confidence)).toEqual([1, 0.3, 0]);
    expect(out.rows[0]!.warnings).not.toContain('low_confidence');
    expect(out.rows[1]!.warnings).toContain('low_confidence');
    expect(out.rows[2]!.warnings).toContain('low_confidence');
  });

  it('replaces an unknown image kind with other', () => {
    const out = run(wrap([], { imageKind: 'meme' }));
    expect(out.imageKind).toBe('other');
    expect(out.warnings).toContainEqual({ code: 'image_kind_unknown', count: 1 });
  });

  it('keeps the model category when it is one of ours, else guesses from the words', () => {
    const out = run(
      wrap([
        row({ category: 'travel', description: 'Dinner' }),
        row({ category: 'Vegetables', description: 'Swiggy dinner' }),
        row({ category: null, description: 'Zzzz' }),
      ]),
    );
    expect(out.rows[0]!.category).toBe(CategoryId.Travel);
    expect(out.rows[1]!.category).toBe(CategoryId.Food);
    expect(out.rows[2]!.category).toBeNull();
  });

  it('keeps scripts as printed and de-duplicates the split list', () => {
    const out = run(
      wrap([row({ description: ' சாப்பாடு   ஹோட்டல் ', splitAmong: ['Asha', 'asha', ' Ravi '] })]),
    );
    expect(out.rows[0]!.description).toBe('சாப்பாடு ஹோட்டல்');
    expect(out.rows[0]!.splitAmong).toEqual(['Asha', 'Ravi']);
  });

  it('caps absurd row counts', () => {
    const rows = Array.from({ length: 350 }, () => row());
    const out = run(wrap(rows));
    expect(out.rows).toHaveLength(300);
    expect(out.warnings).toContainEqual({ code: 'rows_dropped_invalid', count: 50 });
  });

  it('suggests members for every name it saw, null where it cannot tell', () => {
    const out = run(
      wrap([
        row({
          paidBy: 'ASHA',
          splitAmong: ['Ravi K', 'Stranger'],
          perPerson: [{ name: 'asha', amountMinor: 120000 }],
        }),
      ]),
      { members: ['Asha', 'Ravi Kumar', 'Madan'] },
    );
    expect(out.suggestedMembers).toEqual({
      ASHA: 'Asha',
      'Ravi K': 'Ravi Kumar',
      Stranger: null,
      asha: 'Asha',
    });
  });
});

describe('suggestMember', () => {
  const members = ['Asha Rao', 'Ashok', 'Ravi', 'José'];

  it('matches exactly after folding case, accents and punctuation', () => {
    expect(suggestMember('jose', members)).toBe('José');
    expect(suggestMember('RAVI.', members)).toBe('Ravi');
  });

  it('matches a unique prefix or first name', () => {
    expect(suggestMember('Asha', members)).toBe('Asha Rao');
  });

  it('returns null when two members fit', () => {
    expect(suggestMember('Ash', members)).toBeNull();
  });

  it('tolerates one slip in a long enough name', () => {
    expect(suggestMember('Rawi', members)).toBe('Ravi');
    expect(suggestMember('Rv', members)).toBeNull();
  });

  it('never invents a match for "You" or an empty name', () => {
    expect(suggestMember('You', members)).toBeNull();
    expect(suggestMember('  ', members)).toBeNull();
    expect(suggestMember('Asha', [])).toBeNull();
  });
});
