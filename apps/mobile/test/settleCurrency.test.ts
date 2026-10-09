/**
 * What the screens say about a group that settles in its own currency
 * (ADR-003 amendment). The money itself is core's and is property-tested there.
 */

import { describe, expect, it } from 'vitest';

import type { ExpenseRow, ExpenseVersionRow } from '@/data/types';
import {
  convertedCaption,
  convertSwitchBlocks,
  isRatelessTransfer,
  rateFixFor,
} from '@/lib/settleCurrency';

describe('rate-less debts in a converting group', () => {
  it('marks a foreign transfer as rate-less only when the group converts', () => {
    expect(isRatelessTransfer({ currency: 'VND' }, 'INR', true)).toBe(true);
    expect(isRatelessTransfer({ currency: 'INR' }, 'INR', true)).toBe(false);
    // A group that has not opted in pays every currency as before.
    expect(isRatelessTransfer({ currency: 'VND' }, 'INR', false)).toBe(false);
  });
});

describe('the converted caption', () => {
  // The English string; every locale carries one (UiStrings makes it required).
  const template = 'Includes {currencies} bills at their recorded rates';

  it('names the converted currencies by symbol', () => {
    expect(convertedCaption(['VND'], 'en-IN', template)).toBe(
      'Includes ₫ bills at their recorded rates',
    );
  });

  it('says nothing when nothing was converted', () => {
    expect(convertedCaption([], 'en-IN', template)).toBeNull();
  });
});

describe('the settle-in-currency switch', () => {
  const ready: never[] = [];

  it('is free for an admin of a ready group', () => {
    expect(
      convertSwitchBlocks({ on: false, isAdmin: true, readiness: ready, settlementCount: 0 }),
    ).toEqual([]);
  });

  it('lists every reason a group is not ready', () => {
    expect(
      convertSwitchBlocks({
        on: false,
        isAdmin: true,
        readiness: [
          { currency: 'EUR', missing_rates: 0, foreign_settlements: 1 },
          { currency: 'VND', missing_rates: 3, foreign_settlements: 0 },
        ],
        settlementCount: 1,
      }),
    ).toEqual([
      { kind: 'foreignSettlements', currency: 'EUR' },
      { kind: 'missingRates', currency: 'VND', count: 3 },
    ]);
  });

  it('is admin-only', () => {
    expect(
      convertSwitchBlocks({ on: false, isAdmin: false, readiness: ready, settlementCount: 0 }),
    ).toEqual([{ kind: 'adminOnly' }]);
    expect(
      convertSwitchBlocks({ on: true, isAdmin: false, readiness: ready, settlementCount: 0 }),
    ).toEqual([{ kind: 'adminOnly' }]);
  });

  it('stays on once a settlement exists', () => {
    expect(
      convertSwitchBlocks({ on: true, isAdmin: true, readiness: ready, settlementCount: 2 }),
    ).toEqual([{ kind: 'locked' }]);
    expect(
      convertSwitchBlocks({ on: true, isAdmin: true, readiness: ready, settlementCount: 0 }),
    ).toEqual([]);
  });
});

describe('where "Add rate" goes', () => {
  const bill = (
    id: string,
    over: Partial<ExpenseVersionRow> = {},
    row: Partial<ExpenseRow> = {},
  ): ExpenseRow => ({
    id,
    group_id: 'g',
    deleted_at: null,
    created_at: '2026-09-01T00:00:00Z',
    currentVersion: {
      id: `v-${id}`,
      version_no: 1,
      currency: 'VND',
      fx: null,
      expense_date: '2026-09-01',
      split_type: 'equal',
      author_member_id: 'ravi',
      payers: [{ member_id: 'ravi', amount: '100' }],
      shares: [
        { member_id: 'ravi', amount: '50' },
        { member_id: 'me', amount: '50' },
      ],
      ...over,
    } as unknown as ExpenseVersionRow,
    ...row,
  });
  const base = { currency: 'VND', groupCurrency: 'INR', parties: ['me', 'ravi'] };

  it('goes to the backfill when one of the bills is mine to give a rate', () => {
    const rows = [bill('a', { author_member_id: 'me' })];
    expect(rateFixFor({ ...base, rows, myMemberId: 'me' })).toEqual({ kind: 'backfill' });
  });

  it('says whose bill it is when none of them is mine to rewrite', () => {
    const rows = [bill('theirs')];
    expect(rateFixFor({ ...base, rows, myMemberId: 'me' })).toEqual({
      kind: 'notYours',
      expenseId: 'theirs',
      authorId: 'ravi',
    });
    // Nor for someone who has left the group.
    expect(rateFixFor({ ...base, rows, myMemberId: null }).kind).toBe('notYours');
  });

  it('opens a bill that is mine but a split the backfill will not rewrite', () => {
    const rows = [
      bill('itemized', {
        author_member_id: 'me',
        split_type: 'itemized' as ExpenseVersionRow['split_type'],
      }),
    ];
    expect(rateFixFor({ ...base, rows, myMemberId: 'me' })).toEqual({
      kind: 'openBill',
      expenseId: 'itemized',
    });
  });

  it('prefers the bill both people are on, and ignores rated, deleted or other-currency ones', () => {
    const rows = [
      bill('stranger', { shares: [{ member_id: 'anu', amount: '100' }] } as never, {}),
      bill('rated', {
        fx: { num: '32', den: '10000', from: 'VND', to: 'INR', ts: 't', source: 's' },
      }),
      bill('gone', {}, { deleted_at: '2026-09-02T00:00:00Z' }),
      bill('baht', { currency: 'THB' }),
      bill('ours'),
    ];
    expect(rateFixFor({ ...base, rows, myMemberId: 'me' })).toEqual({
      kind: 'notYours',
      expenseId: 'ours',
      authorId: 'ravi',
    });
  });

  it('falls back to settings when nothing local explains the debt', () => {
    expect(rateFixFor({ ...base, rows: [], myMemberId: 'me' })).toEqual({ kind: 'settings' });
  });
});
