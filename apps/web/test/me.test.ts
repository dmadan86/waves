import { describe, expect, it } from 'vitest';

import { decodeTxn, planStatementImport, type MirrorState, type PersonalTxn } from '@waves/core';

import {
  entryData,
  existingExpenses,
  groupByDay,
  ledgerTxns,
  mainCurrency,
  monthBounds,
  monthOf,
  monthsWithEntries,
  monthTotals,
  recordIdFor,
  statementEntry,
  wordedAsEntries,
} from '../src/lib/me';
import { reviewItems } from '../src/lib/statementImport';

const OWNER = '33333333-3333-4333-8333-333333333333';
const txn = (over: Partial<PersonalTxn>): PersonalTxn => ({
  id: 'a',
  kind: 'expense',
  amount: 10000n,
  currency: 'INR',
  category: 'food',
  note: null,
  date: '2026-11-03',
  loanId: null,
  recurringId: null,
  ...over,
});

describe('the ledger from the mirror', () => {
  it('shows only this owner’s live txns, newest day first', () => {
    const row = (
      id: string,
      owner: string,
      date: string,
      kind = 'txn',
      deleted: string | null = null,
    ) => ({
      id,
      owner_user_id: owner,
      record_kind: kind,
      data: { kind: 'expense', amount: '500', currency: 'INR', date },
      created_at: '2026-11-01T00:00:00Z',
      deleted_at: deleted,
    });
    const mirror = {
      cursors: {},
      tables: {
        personal_records: {
          a: row('a', OWNER, '2026-11-01'),
          b: row('b', OWNER, '2026-11-05'),
          c: row('c', 'someone-else', '2026-11-06'),
          d: row('d', OWNER, '2026-11-07', 'budget'),
          e: row('e', OWNER, '2026-11-08', 'txn', '2026-11-09T00:00:00Z'),
        },
      },
    } as unknown as MirrorState;
    expect(ledgerTxns(mirror, OWNER).map((t) => t.id)).toEqual(['b', 'a']);
  });
});

describe('grouping and totals', () => {
  const list = [
    txn({ id: '1', date: '2026-11-03', amount: 10000n }),
    txn({ id: '2', date: '2026-11-03', amount: 5000n, category: 'travel' }),
    txn({ id: '3', date: '2026-11-03', kind: 'income', amount: 99900n }),
    txn({ id: '4', date: '2026-10-30', amount: 700n }),
  ];

  it('groups by day and sums only expenses', () => {
    const days = groupByDay(list, 'INR');
    expect(days.map((d) => [d.date, d.spent])).toEqual([
      ['2026-11-03', 15000n],
      ['2026-10-30', 700n],
    ]);
  });

  it('totals a month by category with shares', () => {
    const totals = monthTotals(list, '2026-11', 'INR');
    expect(totals.map((r) => [r.category, r.spent])).toEqual([
      ['food', 10000n],
      ['travel', 5000n],
    ]);
  });

  it('lists the months with entries and the current one', () => {
    expect(monthsWithEntries(list, '2026-12')).toEqual(['2026-12', '2026-11', '2026-10']);
    expect(monthOf('2026-11-03')).toBe('2026-11');
    expect(mainCurrency(list)).toBe('INR');
    expect(mainCurrency([])).toBe('INR');
  });

  it('gives the month’s bounds, leap years included', () => {
    expect(monthBounds('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthBounds('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
  });
});

describe('the entry form', () => {
  const form = {
    kind: 'expense' as const,
    amountText: '125.50',
    category: 'food',
    note: ' lunch ',
    date: '2026-11-03',
  };

  it('encodes minor units as a string and trims the note', () => {
    expect(entryData(form, 'INR')).toMatchObject({
      amount: '12550',
      note: 'lunch',
      kind: 'expense',
      category: 'food',
    });
  });

  it('refuses a zero, a non-number or a bad date', () => {
    expect(entryData({ ...form, amountText: '0' }, 'INR')).toBeNull();
    expect(entryData({ ...form, amountText: 'abc' }, 'INR')).toBeNull();
    expect(entryData({ ...form, date: 'yesterday' }, 'INR')).toBeNull();
  });

  it('keeps what an edit does not touch', () => {
    const before = txn({ loanId: 'loan-1', recurringId: 'rule-1' });
    expect(entryData(form, 'INR', before)).toMatchObject({
      loanId: 'loan-1',
      recurringId: 'rule-1',
    });
  });
});

describe('statement rows into entries', () => {
  const row = {
    index: 0,
    date: '2026-09-01',
    description: 'UPI-SWIGGY-SWIGGY@ICICI-ICIC0000001-624512345678-FOOD',
    amount: '25000',
    direction: 'debit' as const,
    ref: '624512345678',
    balance: null,
    confidence: 1,
    warnings: [],
  };
  const plan = planStatementImport(wordedAsEntries([row]), { currency: 'INR', existing: [] });
  const [item] = reviewItems(plan);

  it('makes the same record id for the same row, and another for another person', async () => {
    const a = await recordIdFor(OWNER, item!.key);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await recordIdFor(OWNER, item!.key)).toBe(a);
    expect(await recordIdFor('other', item!.key)).not.toBe(a);
  });

  it('applies an edited amount and category, and refuses a bad amount', () => {
    const data = statementEntry(
      item!,
      { amountText: '300', category: 'travel' },
      'INR',
      '2026-11-15',
    );
    expect(data).toMatchObject({
      amount: '30000',
      category: 'travel',
      date: '2026-09-01',
      kind: 'expense',
    });
    expect(statementEntry(item!, { amountText: 'x' }, 'INR', '2026-11-15')).toBeNull();
    expect(statementEntry(item!, { amountText: '0' }, 'INR', '2026-11-15')).toBeNull();
  });

  it('dedupes a second upload against the entries the first one wrote', () => {
    const written = decodeTxn('x', statementEntry(item!, {}, 'INR', '2026-11-15')!);
    const again = planStatementImport(wordedAsEntries([row]), {
      currency: 'INR',
      existing: existingExpenses([written]),
    });
    const [second] = reviewItems(again);
    expect(second!.status).toBe('likely_duplicate');
    expect(second!.ticked).toBe(false);
  });

  it('turns money in into income and an undated row into today', () => {
    const credit = { ...row, direction: 'credit' as const, date: null };
    const [c] = reviewItems(planStatementImport([credit], { currency: 'INR' }));
    expect(statementEntry(c!, {}, 'INR', '2026-11-15')).toMatchObject({
      kind: 'income',
      date: '2026-11-15',
    });
  });
});
