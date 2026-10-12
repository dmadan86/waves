import { describe, expect, it } from 'vitest';

import {
  draftFromSplitwise,
  draftFromTable,
  draftFromText,
  draftFromWavesCsv,
  draftProblems,
  MAX_IMPORT_ROWS,
  type ImportDraft,
} from '../../src/import/draft.js';
import { ImportProblemKind } from '../../src/import/problem.js';
import { decodeBytes, readTable } from '../../src/import/table.js';
import { detectLayout } from '../../src/import/layout.js';
import { fixtureBytes, fixtureText } from './fixtures.js';

const bytes = fixtureBytes;
const text = fixtureText;

const errors = (draft: ImportDraft): ImportProblemKind[] => draftProblems(draft).map((p) => p.kind);

describe('draftFromSplitwise', () => {
  const draft = draftFromSplitwise(text('splitwise-export.csv'));

  it('reads the anonymised export, including a multi-line quoted description', () => {
    expect(draft.source).toBe('splitwise');
    expect(draft.people).toEqual(['Asha', 'Bharath', 'Chitra']);
    expect(errors(draft)).toEqual([]);
    expect(draft.rows.map((row) => row.description)).toEqual([
      'Flat rent',
      'Groceries, veg and milk',
      'Dinner at Toit\n(birthday)',
      'Payment',
      'Electricity',
    ]);
    // The row after the multi-line cell reports its real line in the file.
    expect(draft.rows.map((row) => row.row)).toEqual([2, 3, 4, 6, 7]);
  });

  it('turns a Payment into a settlement, never an expense', () => {
    const payment = draft.rows.find((row) => row.description === 'Payment');
    expect(payment).toMatchObject({
      kind: 'settlement',
      amount: 500000n,
      settlement: { from: 'Asha', to: 'Bharath' },
    });
    expect(draft.rows.filter((row) => row.kind === 'expense')).toHaveLength(4);
  });

  it('keeps Splitwise’s net columns and maps its category names', () => {
    const rent = draft.rows[0]!;
    expect(rent.split).toEqual({
      kind: 'net',
      nets: { Asha: 2000000n, Bharath: -500000n, Chitra: -1500000n },
    });
    expect(rent).toMatchObject({ amount: 3000000n, rawCategory: 'Rent', category: 'home' });
    expect(draft.rows[2]).toMatchObject({ rawCategory: 'Dining out', category: 'food' });
    expect(draft.rows[1]).toMatchObject({ category: 'groceries' });
  });

  it('skips the Total balance row', () => {
    expect(draft.rows.some((row) => /total/i.test(row.description))).toBe(false);
  });

  it('reads slash dates by the country when the file does not decide', () => {
    const csv = 'Date,Description,Category,Cost,Currency,A,B\n03/04/2026,Tea,Food,10,INR,5,-5';
    expect(draftFromSplitwise(csv).rows[0]?.date).toBe('2026-04-03');
    expect(draftFromSplitwise(csv, { country: 'US' }).rows[0]?.date).toBe('2026-03-04');
  });

  it('refuses a file that is not a Splitwise export', () => {
    expect(errors(draftFromSplitwise('Name,Email\nAsha,a@b.c'))).toEqual([
      ImportProblemKind.NoPeople,
    ]);
  });

  it('flags a payment that is not one person paying one other', () => {
    const csv = [
      'Date,Description,Category,Cost,Currency,A,B,C',
      '2026-01-01,Payment,Payment,100.00,INR,100.00,-50.00,-50.00',
    ].join('\n');
    expect(errors(draftFromSplitwise(csv))).toEqual([ImportProblemKind.UnexpectedSettlement]);
  });

  it('refuses to round a cost the currency cannot hold', () => {
    const csv = 'Date,Description,Category,Cost,Currency,A,B\n2026-01-01,Tea,Food,10.005,INR,5,-5';
    expect(errors(draftFromSplitwise(csv))).toEqual([ImportProblemKind.TooManyDecimals]);
  });
});

describe('draftFromText with a generic sheet', () => {
  const draft = draftFromText(text('google-sheets.csv'), { country: 'IN' });
  const row = (description: string) => draft.rows.find((r) => r.description === description)!;

  it('reads the sheet with no errors and the day-first order the file proves', () => {
    expect(errors(draft)).toEqual([]);
    expect(draft.detected).toMatchObject({
      kind: 'generic',
      dateOrder: 'dmy',
      dateBasis: 'forced',
    });
    expect(draft.people).toEqual(['Asha', 'Bharath', 'Chitra']);
    expect(row('Cab to airport')).toMatchObject({
      date: '2026-10-01',
      amount: 120000n,
      currency: 'INR',
    });
  });

  it('reads a single payer, an equal split among named people, and a mapped category', () => {
    expect(row('Cab to airport')).toMatchObject({
      payers: { single: 'Asha' },
      split: { kind: 'equal', among: ['Asha', 'Bharath'] },
      category: 'travel',
    });
    expect(row('Hotel')).toMatchObject({ category: 'stay', amount: 1800000n });
  });

  it('reads weights, percentages and exact amounts', () => {
    expect(row('Hotel').split).toEqual({
      kind: 'shares',
      weights: { Asha: 2, Bharath: 1, Chitra: 1 },
    });
    expect(row('Dinner').split).toEqual({
      kind: 'percent',
      basisPoints: { Asha: 5000, Bharath: 3000, Chitra: 2000 },
    });
    expect(row('Museum').split).toEqual({
      kind: 'exact',
      amounts: { Asha: 30000n, Bharath: 30000n, Chitra: 30000n },
    });
  });

  it('shares a cost between several payers equally, with a warning, and means everyone for an empty split', () => {
    const snacks = row('Snacks');
    expect(snacks.payers).toEqual({ Asha: 22500n, Bharath: 22500n });
    expect(snacks.issues.map((issue) => issue.code)).toEqual([ImportProblemKind.PayerEstimated]);
    expect(snacks.split).toEqual({ kind: 'equal', among: 'everyone' });
  });

  it('treats amounts that do not total the cost as shares, with a warning', () => {
    const csv =
      'Date,Item,Amount,Paid by,Split between\n2026-01-01,Rent,1000,Asha,Asha:3; Bharath:1';
    const row0 = draftFromText(csv).rows[0]!;
    expect(row0.split).toEqual({ kind: 'shares', weights: { Asha: 3, Bharath: 1 } });
    expect(row0.issues).toMatchObject([
      { severity: 'warning', code: ImportProblemKind.SplitDoesNotAddUp },
    ]);
  });

  it('errors on percentages that do not total 100 and on refunds', () => {
    const csv = [
      'Date,Item,Amount,Paid by,Split between',
      '2026-01-01,Rent,1000,Asha,Asha:60%; Bharath:30%',
      '2026-01-02,Refund,-500,Asha,',
      '2026-01-03,Free,0,Asha,',
    ].join('\n');
    expect(errors(draftFromText(csv))).toEqual([
      ImportProblemKind.PercentNot100,
      ImportProblemKind.RefundNotSupported,
      ImportProblemKind.NonPositiveCost,
    ]);
  });

  it('names a mixed-date file’s unreadable rows', () => {
    const csv = ['Date,Item,Amount', '25/04/2026,A,10', '04/25/2026,B,10', '03/04/2026,C,10'].join(
      '\n',
    );
    const mixed = draftFromText(csv);
    expect(mixed.detected?.dateMixed).toBe(true);
    expect(errors(mixed)).toEqual([ImportProblemKind.MixedDateFormats]);
  });

  it('refuses a file with no recognisable columns, and one over the row cap', () => {
    expect(errors(draftFromText('foo,bar\n1,2'))).toEqual([ImportProblemKind.NotAnExport]);
    const big = [
      'Date,Item,Amount',
      ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => '2026-01-01,x,1'),
    ];
    expect(errors(draftFromText(big.join('\n')))).toEqual([ImportProblemKind.TooManyRows]);
  });

  it('reads the 2,000-row stress file', () => {
    const stress = draftFromText(text('stress-2000.csv'));
    expect(stress.rows).toHaveLength(2000);
    expect(errors(stress)).toEqual([]);
    expect(stress.people).toHaveLength(5);
  });
});

describe('other apps’ exports', () => {
  it('reads a Tricount export', () => {
    const draft = draftFromText(text('tricount.csv'));
    expect(errors(draft)).toEqual([]);
    expect(draft.rows[0]).toMatchObject({
      description: 'Villa',
      amount: 1200000n,
      payers: { single: 'Asha' },
      split: { kind: 'equal', among: ['Asha', 'Bharath', 'Chitra'] },
    });
  });

  it('reads a Settle Up export, with a transfer as a settlement', () => {
    const draft = draftFromText(text('settleup.csv'));
    expect(errors(draft)).toEqual([]);
    expect(draft.rows[0]).toMatchObject({
      kind: 'expense',
      description: 'Lunch',
      category: 'food',
    });
    expect(draft.rows[1]).toMatchObject({
      kind: 'settlement',
      settlement: { from: 'Bharath', to: 'Asha' },
    });
  });

  it('reads an Excel semicolon / Windows-1252 / decimal-comma export once the columns are named', () => {
    const table = readTable(decodeBytes(bytes('excel-cp1252.csv')).text);
    expect(table.delimiter).toBe(';');
    expect(table.rows[0]).toEqual(['Datum', 'Beschreibung', 'Betrag', 'Währung', 'Bezahlt von']);
    const layout = {
      ...detectLayout(table),
      headerRow: 0,
      columns: { date: 0, description: 1, amount: 2, currency: 3, paid_by: 4 },
      decimalStyle: 'comma' as const,
    };
    const draft = draftFromTable(table, layout);
    expect(errors(draft)).toEqual([]);
    expect(draft.rows.map((row) => [row.description, row.amount, row.currency])).toEqual([
      ['Café Müller', 1250n, 'EUR'],
      ['Bäckerei', 123456n, 'EUR'],
    ]);
    expect(draft.people).toEqual(['Jürgen', 'Zoë']);
  });

  it('reads cells that look like formulas as plain text', () => {
    const draft = draftFromText(text('malicious.csv'));
    expect(draft.rows.map((row) => row.description)).toEqual([
      '=HYPERLINK("http://evil.example","click")',
      '=1+1',
      '@SUM(A1:A9)',
    ]);
  });
});

describe('draftFromWavesCsv', () => {
  const draft = draftFromWavesCsv(text('waves-export.csv'));

  it('groups the per-person rows back into expenses with exact shares', () => {
    const expenses = draft.rows.filter((row) => row.kind === 'expense');
    expect(expenses.map((row) => row.description)).toEqual(['Dinner', 'Taxi']);
    expect(expenses[0]).toMatchObject({
      amount: 120000n,
      payers: { single: 'Asha' },
      split: { kind: 'exact', amounts: { Asha: 40000n, Bharath: 40000n, Chitra: 40000n } },
    });
  });

  it('splits several payers equally and says the split was estimated', () => {
    const taxi = draft.rows.find((row) => row.description === 'Taxi')!;
    const paid = Object.values(taxi.payers as Record<string, bigint>).sort();
    expect(paid).toEqual([15000n, 15001n]);
    expect(taxi.issues.map((issue) => issue.code)).toEqual([ImportProblemKind.PayerEstimated]);
  });

  it('skips deleted expenses and unconfirmed settlements, and keeps confirmed ones', () => {
    expect(draft.rows.map((row) => row.description)).not.toContain('Mistake');
    const settlements = draft.rows.filter((row) => row.kind === 'settlement');
    expect(settlements).toHaveLength(1);
    expect(settlements[0]).toMatchObject({
      amount: 20000n,
      settlement: { from: 'Chitra', to: 'Asha' },
    });
    expect(errors(draft)).toEqual([]);
  });

  it('refuses a file that is not a Waves export', () => {
    expect(errors(draftFromWavesCsv('a,b\n1,2'))).toEqual([ImportProblemKind.NotAnExport]);
  });
});
