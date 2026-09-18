/**
 * The contract between the chart and its drill.
 *
 * Tapping a column that says ₹48,200 has to land on a page that totals
 * ₹48,200. The two figures are computed by different code — `monthTotals` over
 * the spending rows, `monthRows` over the expenses — so this checks them
 * against each other rather than against numbers written out by hand. If they
 * ever disagree, neither can be trusted.
 */

import { describe, expect, it } from 'vitest';

import { computeSpendingRows, monthTotals } from '@waves/core';

import { byDay, drillTotal, isCurrencyCode, monthRows, myShare } from '../src/lib/monthDrill';

const ASHA = 'asha';
const RAVI = 'ravi';
const MEERA = 'meera';

/** One bill: who split it, in what, when. */
function bill(
  id: string,
  expense_date: string,
  amount: string,
  shares: [string, string][],
  currency = 'INR',
) {
  return {
    id,
    deleted_at: null,
    currentVersion: {
      currency,
      category: 'food',
      expense_date,
      amount,
      shares: shares.map(([member_id, share]) => ({ member_id, amount: share })),
    },
  };
}

const LEDGER = [
  bill('a', '2026-09-03', '10000', [
    [ASHA, '5000'],
    [RAVI, '5000'],
  ]),
  bill('b', '2026-09-03', '6000', [
    [RAVI, '3000'],
    [MEERA, '3000'],
  ]),
  bill('c', '2026-09-21', '9000', [
    [ASHA, '3000'],
    [RAVI, '3000'],
    [MEERA, '3000'],
  ]),
  // Another month, and another currency: neither belongs to September in INR.
  bill('d', '2026-08-11', '4000', [[ASHA, '4000']]),
  bill('e', '2026-09-14', '7000', [[ASHA, '7000']], 'THB'),
];

/** What the chart's September column says, for a scope. */
function column(memberId: string | null): bigint {
  const rows = computeSpendingRows(LEDGER).filter(
    (row) => row.currency === 'INR' && (memberId === null || row.member_id === memberId),
  );
  return monthTotals(rows).find((total) => total.month === '2026-09-01')?.value ?? 0n;
}

/** What the drill adds up to, for the same scope. */
function drill(memberId: string | null): bigint {
  return drillTotal(
    monthRows(LEDGER, {
      month: '2026-09',
      currency: 'INR',
      mine: memberId !== null,
      myMemberId: memberId,
    }),
  );
}

describe('the drill reconciles with the column', () => {
  it('agrees about the whole group', () => {
    // 10,000 + 6,000 + 9,000 — the August bill and the baht one are elsewhere.
    expect(drill(null)).toBe(25000n);
    expect(drill(null)).toBe(column(null));
  });

  it('agrees about one person, for each person', () => {
    for (const member of [ASHA, RAVI, MEERA]) {
      expect(drill(member)).toBe(column(member));
    }
    // And the personal figures are the shares, not the bills.
    expect(drill(ASHA)).toBe(8000n);
    expect(drill(RAVI)).toBe(11000n);
  });

  it('agrees that somebody with no shares here has nothing', () => {
    expect(drill('stranger')).toBe(0n);
    expect(drill('stranger')).toBe(column('stranger'));
  });
});

describe('monthRows', () => {
  it('leaves out a bill this person had no share in, rather than showing a zero', () => {
    // Meera is not on bill 'a'. The column never counted it, so a zero row
    // would put something on screen the figure above it does not include.
    const ids = monthRows(LEDGER, {
      month: '2026-09',
      currency: 'INR',
      mine: true,
      myMemberId: MEERA,
    }).map((row) => row.expense.id);
    expect(ids).toEqual(['b', 'c']);
  });

  it('shows the whole bill in group scope and the share in mine', () => {
    const group = monthRows(LEDGER, {
      month: '2026-09',
      currency: 'INR',
      mine: false,
      myMemberId: ASHA,
    });
    const mine = monthRows(LEDGER, {
      month: '2026-09',
      currency: 'INR',
      mine: true,
      myMemberId: ASHA,
    });
    expect(group.find((row) => row.expense.id === 'a')?.amount).toBe(10000n);
    expect(mine.find((row) => row.expense.id === 'a')?.amount).toBe(5000n);
  });

  it('keeps out another currency, another month, and anything deleted', () => {
    const deleted = [{ ...LEDGER[0]!, id: 'gone', deleted_at: '2026-09-04T00:00:00Z' }];
    expect(
      monthRows([...LEDGER, ...deleted], {
        month: '2026-09',
        currency: 'INR',
        mine: false,
        myMemberId: null,
      }).map((row) => row.expense.id),
    ).toEqual(['a', 'b', 'c']);
  });

  it('reads the month off the date string, so no timezone can move it', () => {
    // The 1st, which is the day a timezone would push into the month before.
    const first = [bill('first', '2026-09-01', '1000', [[ASHA, '1000']])];
    expect(
      monthRows(first, { month: '2026-09', currency: 'INR', mine: false, myMemberId: null }),
    ).toHaveLength(1);
  });
});

describe('byDay', () => {
  it('buckets by day, newest first, and each day totals its own rows', () => {
    const days = byDay(
      monthRows(LEDGER, { month: '2026-09', currency: 'INR', mine: false, myMemberId: null }),
    );
    expect(days.map(([day]) => day)).toEqual(['2026-09-21', '2026-09-03']);
    expect(days.map(([, bucket]) => bucket.total)).toEqual([9000n, 16000n]);
    // The days add back up to the screen's own total.
    expect(days.reduce((sum, [, bucket]) => sum + bucket.total, 0n)).toBe(drill(null));
  });
});

describe('myShare', () => {
  it('adds a member up across several share rows, and answers zero for nobody', () => {
    const shares = [
      { member_id: ASHA, amount: '300' },
      { member_id: RAVI, amount: '700' },
      { member_id: ASHA, amount: '200' },
    ];
    expect(myShare(shares, ASHA)).toBe(500n);
    expect(myShare(shares, null)).toBe(0n);
  });
});

describe('isCurrencyCode', () => {
  it('accepts a code and refuses what a typed URL can carry', () => {
    expect(isCurrencyCode('INR')).toBe(true);
    expect(isCurrencyCode('thb')).toBe(true);
    // Intl throws a RangeError on all of these, which would take the route down.
    for (const bad of ['', 'RUPEES', 'IN', '12', '₹', 'IN R']) {
      expect(isCurrencyCode(bad)).toBe(false);
    }
  });
});
