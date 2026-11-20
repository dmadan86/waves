import { describe, expect, it } from 'vitest';

import { groupExpensesByPayer } from '../src/lib/expensesByPayer';

const bill = (id: string, payers: [string, string][], currency = 'INR', fx: unknown = null) => ({
  id,
  currentVersion: {
    currency,
    amount: payers.reduce((s, [, a]) => s + BigInt(a), 0n).toString(),
    fx,
    payers: payers.map(([member_id, amount]) => ({ member_id, amount })),
  } as never,
});

describe('groupExpensesByPayer', () => {
  it('groups by payer, highest total first', () => {
    const out = groupExpensesByPayer(
      [bill('a', [['ravi', '100']]), bill('b', [['asha', '500']]), bill('c', [['ravi', '200']])],
      'INR',
    );
    expect(out.map((s) => [s.memberId, s.total, s.rows.length])).toEqual([
      ['asha', 500n, 1],
      ['ravi', 300n, 2],
    ]);
  });

  it('lists a multi-payer bill under each payer with their own share', () => {
    const out = groupExpensesByPayer(
      [
        bill('a', [
          ['ravi', '700'],
          ['asha', '300'],
        ]),
      ],
      'INR',
    );
    expect(out.map((s) => [s.memberId, s.total, s.rows.length])).toEqual([
      ['ravi', 700n, 1],
      ['asha', 300n, 1],
    ]);
  });

  it('converts foreign bills and skips rate-less ones from the total', () => {
    const out = groupExpensesByPayer(
      [bill('a', [['ravi', '100']], 'USD', null), bill('b', [['ravi', '50']])],
      'INR',
    );
    expect(out[0]!.total).toBe(50n);
    expect(out[0]!.rows).toHaveLength(2);
  });

  it('respects a pre-filtered list', () => {
    const all = [bill('a', [['ravi', '100']]), bill('b', [['asha', '500']])];
    const out = groupExpensesByPayer(
      all.filter((b) => b.id === 'a'),
      'INR',
    );
    expect(out).toHaveLength(1);
  });
});
