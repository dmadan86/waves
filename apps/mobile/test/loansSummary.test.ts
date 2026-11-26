import { describe, expect, it } from 'vitest';

import { loanTotals, matchesLoanFilter, repaid } from '../src/lib/loansSummary';

describe('loans summary', () => {
  it('totals what you owe and are owed, with counts', () => {
    const t = loanTotals([
      { direction: 'borrowed', left: 200n },
      { direction: 'borrowed', left: 50n },
      { direction: 'lent', left: 30n },
    ]);
    expect(t).toMatchObject({ owe: 250n, owed: 30n, total: 280n });
    expect(t.counts).toEqual({ all: 3, owe: 2, owed: 1 });
  });

  it('filters by direction', () => {
    expect(matchesLoanFilter('borrowed', 'owe')).toBe(true);
    expect(matchesLoanFilter('borrowed', 'owed')).toBe(false);
    expect(matchesLoanFilter('lent', 'owed')).toBe(true);
    expect(matchesLoanFilter('lent', 'all')).toBe(true);
  });

  it('excludes closed loans from totals and counts', () => {
    expect(
      loanTotals([
        { direction: 'borrowed', left: 120n },
        { direction: 'borrowed', left: 80n, status: 'closed' },
      ]),
    ).toMatchObject({ owe: 120n, total: 120n, counts: { all: 1, owe: 1, owed: 0 } });
  });

  it('computes repaid share, clamped', () => {
    expect(repaid(200n, 200n)).toEqual({ amount: 0n, percent: 0 });
    expect(repaid(200n, 50n)).toEqual({ amount: 150n, percent: 75 });
    expect(repaid(200n, 0n)).toEqual({ amount: 200n, percent: 100 });
    expect(repaid(200n, 300n).amount).toBe(0n);
    expect(repaid(0n, 0n).percent).toBe(0);
  });
});
