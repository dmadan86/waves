import { describe, expect, it } from 'vitest';

import {
  answerAmountsAreGrounded,
  buildSpendingDigest,
  digestFacts,
  fallbackAnswer,
  digestMerchant,
  type PersonalTxn,
} from '../src/personal/index.js';

let n = 0;
const txn = (over: Partial<PersonalTxn>): PersonalTxn => ({
  id: `t${n++}`,
  kind: 'expense',
  amount: 0n,
  currency: 'INR',
  category: null,
  note: null,
  date: '2026-10-15',
  loanId: null,
  recurringId: null,
  ...over,
});
const opts = { from: '2026-10-01', to: '2026-10-31', currency: 'INR' };

describe('digestMerchant', () => {
  it('reads bank narrations and plain notes', () => {
    expect(digestMerchant('UPI-SWIGGY-SWIGGY@ICICI-ICIC0000001-627412345678-ORDER')).toBe('swiggy');
    expect(digestMerchant('NETFLIX.COM 4481')).toBe('netflix');
    expect(digestMerchant('Netflix')).toBe('netflix');
    expect(digestMerchant('  ')).toBeNull();
    expect(digestMerchant(null)).toBeNull();
    expect(digestMerchant('627412345678')).toBeNull();
  });
  it('never keeps an email or long reference', () => {
    expect(digestMerchant('ravi.kumar@okaxis')).not.toContain('@');
  });
});

describe('totals and comparison', () => {
  const entries = [
    txn({ amount: 50_000n, category: 'food', date: '2026-10-03', note: 'Swiggy' }),
    txn({ amount: 30_000n, category: 'food', date: '2026-10-20', note: 'Swiggy' }),
    txn({ amount: 10_000n, category: 'travel', date: '2026-09-30' }),
    txn({ amount: 20_000n, category: 'food', date: '2026-09-10', note: 'Zomato' }),
    txn({ amount: 99_999n, currency: 'GBP', date: '2026-10-05' }),
    txn({ kind: 'income', amount: 500_000n, date: '2026-10-01' }),
    txn({ amount: 1n, date: '2026-08-01' }),
  ];
  const d = buildSpendingDigest(entries, opts);

  it('sums only the window and currency, as strings', () => {
    expect(d.spentMinor).toBe('80000');
    expect(d.incomeMinor).toBe('500000');
    expect(d.previous).toEqual({ from: '2026-08-31', to: '2026-09-30' });
    expect(d.previousSpentMinor).toBe('30000');
    expect(d.deltaMinor).toBe('50000');
    expect(d.deltaPercent).toBe(166);
  });
  it('groups by category and month', () => {
    expect(d.byCategoryByMonth).toEqual([
      { month: '2026-10', category: 'food', totalMinor: '80000' },
    ]);
  });
  it('compares categories, biggest move first', () => {
    expect(d.categoryChanges[0]).toEqual({
      category: 'food',
      currentMinor: '80000',
      previousMinor: '20000',
      deltaMinor: '60000',
    });
    expect(d.categoryChanges[1]).toMatchObject({ category: 'travel', deltaMinor: '-10000' });
  });
  it('ranks merchants', () => {
    expect(d.topMerchants).toEqual([{ merchant: 'swiggy', totalMinor: '80000', count: 2 }]);
  });
  it('has a null percent when there was no previous spend', () => {
    expect(buildSpendingDigest([], opts).deltaPercent).toBeNull();
  });
  it('is deterministic', () => {
    expect(JSON.stringify(buildSpendingDigest([...entries].reverse(), opts))).toBe(
      JSON.stringify(d),
    );
  });
  it('contains no raw notes or floats', () => {
    expect(JSON.stringify(d)).not.toMatch(/\d\.\d/);
  });
});

describe('recurring detection', () => {
  const monthly = (merchant: string, amounts: bigint[], start = '2026-07-05') =>
    amounts.map((amount, i) => {
      const [y, m, day] = start.split('-').map(Number) as [number, number, number];
      const date = new Date(Date.UTC(y, m - 1 + i, day)).toISOString().slice(0, 10);
      return txn({ amount, note: merchant, date });
    });
  const find = (entries: PersonalTxn[], to = '2026-10-31') =>
    buildSpendingDigest(entries, { ...opts, to }).recurring;

  it('finds a monthly charge with 3 occurrences, using history before the window', () => {
    const r = find(monthly('Netflix', [64_900n, 64_900n, 64_900n, 64_900n]));
    expect(r).toEqual([
      {
        merchant: 'netflix',
        amountMinor: '64900',
        cadence: 'monthly',
        lastDate: '2026-10-05',
        occurrences: 4,
      },
    ]);
  });
  it('tolerates a ±10% price change', () => {
    expect(find(monthly('Spotify', [11_900n, 12_500n, 12_900n]))).toHaveLength(1);
  });
  it('rejects a big amount jump and only two monthly occurrences', () => {
    expect(find(monthly('Gym', [10_000n, 10_000n, 30_000n]))).toHaveLength(0);
    expect(find(monthly('Cloud', [1_000n, 1_000n], '2026-09-05'))).toHaveLength(0);
  });
  it('rejects irregular gaps', () => {
    const e = ['2026-08-01', '2026-08-09', '2026-10-28'].map((date) =>
      txn({ amount: 500n, note: 'Chai', date }),
    );
    expect(find(e)).toHaveLength(0);
  });
  it('detects weekly, and yearly with just 2', () => {
    const weekly = ['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25'].map((date) =>
      txn({ amount: 9_900n, note: 'Milk subscription', date }),
    );
    expect(find(weekly)[0]).toMatchObject({ cadence: 'weekly', occurrences: 4 });
    const yearly = ['2025-10-20', '2026-10-20'].map((date) =>
      txn({ amount: 99_900n, note: 'Domain renewal', date }),
    );
    expect(find(yearly)[0]).toMatchObject({ cadence: 'yearly', occurrences: 2 });
  });
  it('drops a charge that stopped long ago', () => {
    expect(find(monthly('Old app', [100n, 100n, 100n], '2026-01-05'))).toHaveLength(0);
  });
  it('ignores income, other currencies and notes with no merchant', () => {
    const e = monthly('Salary', [5n, 5n, 5n]).map((t) => ({ ...t, kind: 'income' as const }));
    expect(find(e)).toHaveLength(0);
    expect(
      find(monthly('Netflix', [1n, 1n, 1n]).map((t) => ({ ...t, currency: 'USD' }))),
    ).toHaveLength(0);
  });
  it('counts same-day duplicates once', () => {
    const e = [
      ...monthly('Netflix', [500n, 500n]),
      txn({ amount: 500n, note: 'Netflix', date: '2026-08-05' }),
    ];
    expect(find(e)).toHaveLength(0);
  });
});

describe('facts and grounding', () => {
  const d = buildSpendingDigest(
    [
      txn({ amount: 125_050n, category: 'food', date: '2026-10-03', note: 'Swiggy' }),
      txn({ amount: 50_000n, category: 'food', date: '2026-09-03', note: 'Swiggy' }),
    ],
    opts,
  );
  it('facts carry only digest amounts', () => {
    const f = digestFacts(d);
    expect(f[0]).toEqual({ label: 'Spent this period', amountMinor: '125050', currency: 'INR' });
    expect(f.every((x) => /^-?\d+$/.test(x.amountMinor))).toBe(true);
  });
  it('accepts digest amounts in any grouping', () => {
    expect(answerAmountsAreGrounded('You spent ₹1,250.50, up 150% from ₹500.00.', d)).toBe(true);
    expect(answerAmountsAreGrounded('You spent INR 1250.5 in 2026-10, 2 orders.', d)).toBe(true);
  });
  it('rejects an invented amount or percentage', () => {
    expect(answerAmountsAreGrounded('You spent ₹1,300.00.', d)).toBe(false);
    expect(answerAmountsAreGrounded('That is up 90% on last month.', d)).toBe(false);
    expect(answerAmountsAreGrounded('About 2,000 rupees.', d)).toBe(false);
  });
  it('the fallback answer is itself grounded', () => {
    const text = fallbackAnswer(d);
    expect(text).toContain('INR 1250.50');
    expect(answerAmountsAreGrounded(text, d)).toBe(true);
  });
});
