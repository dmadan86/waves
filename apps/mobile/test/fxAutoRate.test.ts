/**
 * Making sure a foreign bill carries a rate: the decisions, without the screens.
 */

import { describe, expect, it } from 'vitest';

import { rateFromDecimal, toFxRecord, type FxRecord } from '@waves/core';

import type { ExpenseRow, ExpenseVersionRow } from '../src/data/types';
import {
  backfillRateFor,
  countMissing,
  fetchKey,
  needsRate,
  rateDateFor,
  selectBackfill,
  shouldAutoFetch,
  shouldPinFetched,
} from '../src/lib/fxAutoRate';

const ME = 'member-me';
const OTHER = 'member-other';

const VND_FX: FxRecord = toFxRecord(rateFromDecimal('0.0032', 'VND', 'INR', { source: 'ecb' }));
const PINNED = rateFromDecimal('0.0031', 'VND', 'INR', { source: 'manual' });

function expense(
  id: string,
  over: Partial<ExpenseVersionRow> = {},
  row: Partial<ExpenseRow> = {},
): ExpenseRow {
  const version = {
    id: `v-${id}`,
    version_no: 1,
    currency: 'VND',
    fx: null,
    expense_date: '2026-09-01',
    split_type: 'equal',
    author_member_id: ME,
    payers: [{ member_id: ME, amount: '100' }],
    ...over,
  } as unknown as ExpenseVersionRow;
  return {
    id,
    group_id: 'g',
    deleted_at: null,
    created_at: '2026-09-01T00:00:00Z',
    currentVersion: version,
    ...row,
  };
}

describe('needsRate', () => {
  it('is true for a foreign bill with no rate', () => {
    expect(needsRate({ currency: 'VND', groupCurrency: 'INR', fx: null })).toBe(true);
    expect(needsRate({ currency: 'VND', groupCurrency: 'INR', fx: undefined })).toBe(true);
  });
  it('is false once a rate is there, or when the bill is in the group currency', () => {
    expect(needsRate({ currency: 'VND', groupCurrency: 'INR', fx: VND_FX })).toBe(false);
    expect(needsRate({ currency: 'INR', groupCurrency: 'INR', fx: null })).toBe(false);
  });
});

describe('the pinned rate beats fetching', () => {
  it('does not fetch while the trip has a rate for the pair', () => {
    expect(
      shouldAutoFetch({ currency: 'VND', groupCurrency: 'INR', fx: null, pinned: PINNED }),
    ).toBe(false);
  });
  it('fetches only when there is no rate of any kind', () => {
    expect(shouldAutoFetch({ currency: 'VND', groupCurrency: 'INR', fx: null, pinned: null })).toBe(
      true,
    );
    expect(
      shouldAutoFetch({ currency: 'VND', groupCurrency: 'INR', fx: VND_FX, pinned: null }),
    ).toBe(false);
  });
  it('a backfill uses the pinned rate over a fetched one', () => {
    const fetched = toFxRecord(rateFromDecimal('0.0040', 'VND', 'INR', { source: 'ecb' }));
    expect(backfillRateFor({ currency: 'VND' }, 'INR', PINNED, fetched)).toEqual(
      toFxRecord(PINNED),
    );
    expect(backfillRateFor({ currency: 'VND' }, 'INR', null, fetched)).toBe(fetched);
  });
  it('never uses a rate for a different pair', () => {
    const thb = toFxRecord(rateFromDecimal('2.5', 'THB', 'INR', { source: 'ecb' }));
    expect(backfillRateFor({ currency: 'VND' }, 'INR', null, thb)).toBeNull();
    expect(backfillRateFor({ currency: 'VND' }, 'INR', null, null)).toBeNull();
  });
});

describe('rateDateFor', () => {
  it('asks for the bill’s own day only when it is in the past', () => {
    expect(rateDateFor('2026-09-01', '2026-10-09')).toBe('2026-09-01');
    expect(rateDateFor('2026-10-09', '2026-10-09')).toBeNull();
    expect(rateDateFor('2026-10-20', '2026-10-09')).toBeNull();
    expect(rateDateFor(undefined, '2026-10-09')).toBeNull();
    expect(rateDateFor('nonsense', '2026-10-09')).toBeNull();
  });
  it('keys fetches by currency and day', () => {
    expect(fetchKey('VND', null)).not.toBe(fetchKey('VND', '2026-09-01'));
  });
});

describe('shouldPinFetched', () => {
  const base = {
    isAdmin: true,
    pinnedCurrencies: [] as string[],
    currency: 'VND',
    groupCurrency: 'INR',
    forDate: null,
  };
  it('pins the first rate captured for a currency', () => {
    expect(shouldPinFetched(base)).toBe(true);
  });
  it('never overwrites a rate that is already pinned', () => {
    expect(shouldPinFetched({ ...base, pinnedCurrencies: ['VND'] })).toBe(false);
  });
  it('leaves it to an admin, and to rates for today', () => {
    expect(shouldPinFetched({ ...base, isAdmin: false })).toBe(false);
    expect(shouldPinFetched({ ...base, forDate: '2026-09-01' })).toBe(false);
  });
});

describe('backfill selection', () => {
  it('skips expenses that already have a rate', () => {
    const rows = [expense('a'), expense('b', { fx: VND_FX })];
    expect(selectBackfill(rows, 'INR', ME).map((r) => r.id)).toEqual(['a']);
  });
  it('skips group-currency, deleted and un-rewritable bills', () => {
    const rows = [
      expense('inr', { currency: 'INR' }),
      expense('gone', {}, { deleted_at: '2026-09-02T00:00:00Z' }),
      expense('itemized', { split_type: 'itemized' as ExpenseVersionRow['split_type'] }),
      expense('ok'),
    ];
    expect(selectBackfill(rows, 'INR', ME).map((r) => r.id)).toEqual(['ok']);
  });
  it('leaves other people’s bills to them but still counts them as missing', () => {
    const theirs = expense('theirs', {
      author_member_id: OTHER,
      payers: [{ member_id: OTHER, amount: '100' }] as ExpenseVersionRow['payers'],
    });
    const rows = [theirs, expense('mine')];
    expect(selectBackfill(rows, 'INR', ME).map((r) => r.id)).toEqual(['mine']);
    expect(countMissing(rows, 'INR')).toBe(2);
    expect(selectBackfill(rows, 'INR', null)).toEqual([]);
  });
  it('is idempotent: once rates are attached nothing is selected again', () => {
    const rows = [expense('a'), expense('b')];
    const done = rows.map((row) => ({
      ...row,
      currentVersion: { ...row.currentVersion!, fx: VND_FX },
    }));
    expect(selectBackfill(rows, 'INR', ME)).toHaveLength(2);
    expect(selectBackfill(done, 'INR', ME)).toHaveLength(0);
    expect(countMissing(done, 'INR')).toBe(0);
  });
});
