import { describe, expect, it } from 'vitest';

import { draftFromText } from '../../src/import/draft.js';
import { findDuplicates } from '../../src/import/dedupe.js';
import { buildTemplateCsv } from '../../src/import/template.js';
import { readTable } from '../../src/import/table.js';

const existing = [
  { id: 'e1', date: '2026-10-01', currency: 'INR', amount: 345000n, description: 'Dinner at Toit' },
  { id: 'e2', date: '2026-10-02', currency: 'INR', amount: 60000n, description: 'Cab to airport' },
];

const row = (key: string, date: string, amount: bigint, description: string, currency = 'INR') => ({
  key,
  date,
  currency,
  amount,
  description,
});

describe('findDuplicates', () => {
  it('flags an exact match as likely, ignoring case and gateway noise', () => {
    const report = findDuplicates([row('a', '2026-10-01', 345000n, 'DINNER at TOIT')], existing);
    expect(report.existing.get('a')).toEqual({ expenseId: 'e1', level: 'likely' });
  });

  it('flags the same amount a day away with similar wording as possible', () => {
    const report = findDuplicates([row('a', '2026-10-02', 345000n, 'Toit dinner')], existing);
    expect(report.existing.get('a')).toEqual({ expenseId: 'e1', level: 'possible' });
  });

  it('does not flag a different amount, a different currency, a far date or different words', () => {
    const report = findDuplicates(
      [
        row('amount', '2026-10-01', 345001n, 'Dinner at Toit'),
        row('currency', '2026-10-01', 345000n, 'Dinner at Toit', 'USD'),
        row('date', '2026-10-05', 345000n, 'Toit dinner'),
        row('words', '2026-10-01', 345000n, 'Rent'),
      ],
      existing,
    );
    expect(report.existing.size).toBe(0);
  });

  it('notes repeats within the file without treating them as existing duplicates', () => {
    const report = findDuplicates(
      [
        row('a', '2026-11-01', 5000n, 'Coffee'),
        row('b', '2026-11-01', 5000n, 'Coffee'),
        row('c', '2026-11-02', 5000n, 'Coffee'),
      ],
      [],
    );
    expect([...report.withinFile]).toEqual([['b', 'a']]);
    expect(report.existing.size).toBe(0);
  });
});

describe('buildTemplateCsv', () => {
  it('writes the header and two examples that use the group’s members and currency', () => {
    const csv = buildTemplateCsv(['Asha', 'Bharath', 'Chitra'], 'AED');
    expect(csv.split('\n')[0]).toBe(
      'date,description,amount,currency,paid_by,split_between,category',
    );
    expect(csv).toContain('AED');
    expect(csv).toContain('Asha');
  });

  it('writes a formula-looking name as text, and reads it back unchanged', () => {
    const csv = buildTemplateCsv(['=HYPERLINK("x")', 'Asha'], 'INR');
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(draftFromText(csv).people).toContain('=HYPERLINK("x")');
  });

  it('re-parses to the rows it describes', () => {
    const csv = buildTemplateCsv(['Asha', 'Bharath', 'Chitra'], 'INR');
    const draft = draftFromText(csv);
    expect(draft.fileProblems).toEqual([]);
    expect(draft.rows.flatMap((r) => r.issues)).toEqual([]);
    expect(
      draft.rows.map((r) => [
        r.description,
        r.date,
        r.amount,
        r.currency,
        r.payers,
        r.split,
        r.category,
      ]),
    ).toEqual([
      [
        'Dinner',
        '2026-01-15',
        120000n,
        'INR',
        { single: 'Asha' },
        { kind: 'equal', among: 'everyone' },
        'food',
      ],
      [
        'Cab to the airport',
        '2026-01-15',
        60000n,
        'INR',
        { single: 'Bharath' },
        { kind: 'equal', among: ['Asha', 'Bharath'] },
        'travel',
      ],
    ]);
  });

  it('quotes names that need it and respects zero-decimal currencies', () => {
    const csv = buildTemplateCsv(['Smith, Jo', 'Ann'], 'JPY');
    expect(readTable(csv).rows[1]).toContain('Smith, Jo');
    expect(draftFromText(csv).rows[0]?.amount).toBe(1200n);
  });
});
