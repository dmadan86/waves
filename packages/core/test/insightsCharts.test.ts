/**
 * The coarsening between the spending rows and the chart.
 *
 * The cases that matter are the ones that drew wrong before: several unknown
 * category values each getting their own "Other" bar, and a custom tag falling
 * into "Other" because one of its expenses was saved without a snapshot.
 */

import { describe, expect, it } from 'vitest';

import {
  categoryTotals,
  monthTotals,
  spendingCurrencies,
  spendingTotal,
} from '../src/insights/charts';
import type { SpendingRow } from '../src/insights/spending';

function row(over: Partial<SpendingRow> = {}): SpendingRow {
  return {
    member_id: 'member-1',
    currency: 'INR',
    category: 'food',
    month: '2026-09-01',
    share_amount: '10000',
    expense_count: 1,
    ...over,
  };
}

describe('categoryTotals', () => {
  it('adds a category up across months and members', () => {
    const totals = categoryTotals([
      row({ share_amount: '10000' }),
      row({ member_id: 'member-2', share_amount: '5000' }),
      row({ month: '2026-08-01', share_amount: '2500' }),
    ]);
    expect(totals).toHaveLength(1);
    expect(totals[0]?.value).toBe(17500n);
  });

  it('folds every unknown value into the one Other it always was', () => {
    // A legacy id, a tag whose row never arrived, and an empty string all
    // resolve to the built-in "Other". Bucketing by the raw string drew three
    // bars, all labelled "Other".
    const totals = categoryTotals([
      row({ category: 'legacy-id-42', share_amount: '1000' }),
      row({ category: 'tag:missing', share_amount: '2000' }),
      row({ category: '', share_amount: '3000' }),
    ]);
    expect(totals).toHaveLength(1);
    expect(totals[0]?.key).toBe('other');
    expect(totals[0]?.value).toBe(6000n);
  });

  it('keeps a custom tag its own bar, and takes the first snapshot that turns up', () => {
    // The tag is only itself while its snapshot is present. Taking the null
    // from the first row would send the whole tag into "Other" on the strength
    // of one expense saved without it.
    const meta = { label: 'Chai', icon: 'cafe', tint: 'peach' } as const;
    const totals = categoryTotals([
      row({ category: 'tag:1', category_meta: null, share_amount: '1000' }),
      row({ category: 'tag:1', category_meta: meta, share_amount: '2000' }),
    ]);
    expect(totals).toHaveLength(1);
    expect(totals[0]?.meta).toEqual(meta);
    expect(totals[0]?.value).toBe(3000n);
    expect(totals[0]?.key).not.toBe('other');
  });

  it('puts the largest first and breaks ties by key, not by insertion', () => {
    const totals = categoryTotals([
      row({ category: 'travel', share_amount: '1000' }),
      row({ category: 'food', share_amount: '9000' }),
      row({ category: 'stay', share_amount: '1000' }),
    ]);
    expect(totals.map((total) => total.value)).toEqual([9000n, 1000n, 1000n]);
    // Equal values sort by their resolved key, so the order is the same twice.
    expect(totals.slice(1).map((total) => total.key)).toEqual(['stay', 'travel']);
  });

  it('says nothing about no rows', () => {
    expect(categoryTotals([])).toEqual([]);
  });
});

describe('monthTotals', () => {
  it('adds a month up and reads oldest first', () => {
    const totals = monthTotals([
      row({ month: '2026-09-01', share_amount: '3000' }),
      row({ month: '2026-07-01', share_amount: '1000' }),
      row({ month: '2026-09-01', category: 'travel', share_amount: '2000' }),
    ]);
    expect(totals).toEqual([
      { month: '2026-07-01', value: 1000n },
      { month: '2026-09-01', value: 5000n },
    ]);
  });

  it('keeps the most recent months when there are more than fit', () => {
    const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
    const totals = monthTotals(
      months.map((month) => row({ month: `${month}-01` })),
      3,
    );
    expect(totals.map((total) => total.month)).toEqual(['2026-05-01', '2026-06-01', '2026-07-01']);
  });
});

describe('spendingTotal', () => {
  it('adds the rows in minor units', () => {
    expect(spendingTotal([row({ share_amount: '333' }), row({ share_amount: '334' })])).toBe(667n);
  });
});

describe('spendingCurrencies', () => {
  it("puts the group's own first and the rest in order", () => {
    const rows = [row({ currency: 'USD' }), row({ currency: 'INR' }), row({ currency: 'EUR' })];
    expect(spendingCurrencies(rows, 'INR')).toEqual(['INR', 'EUR', 'USD']);
  });

  it('does not invent the group currency when nothing was spent in it', () => {
    expect(spendingCurrencies([row({ currency: 'THB' })], 'INR')).toEqual(['THB']);
  });
});
