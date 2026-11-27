import { describe, expect, it } from 'vitest';

import { encodeProperty, encodeTxn, recurringOccurrenceId } from '@waves/core';

import { incomeTotal } from '../../../packages/core/src/group/household';
import { readFileSync } from 'node:fs';
import {
  decodeWealth,
  groupRentalsSummary,
  ownActiveProperties,
  rentEntryId,
  selectRentalRecords,
  spaceParams,
  type RentalRecord,
} from '@/lib/rentalScope';

const prop = (id: string, by?: string, status: 'active' | 'closed' = 'active'): RentalRecord => ({
  id,
  record_kind: 'property',
  created_by: by,
  data: encodeProperty({
    type: 'house',
    name: id,
    locality: null,
    address: null,
    currency: 'INR',
    status,
    note: null,
  }),
});
const rent = (id: string, date: string, amount: bigint, currency = 'INR'): RentalRecord => ({
  id,
  record_kind: 'txn',
  data: encodeTxn({
    kind: 'income',
    amount,
    currency,
    category: 'inc.rent',
    note: 'Rent',
    date,
    loanId: null,
    recurringId: null,
  } as never),
});

describe('store selection by scope', () => {
  it('reads Personal without a space and the group with one', () => {
    expect(selectRentalRecords(undefined, ['p'], ['g'])).toEqual(['p']);
    expect(selectRentalRecords('grp', ['p'], ['g'])).toEqual(['g']);
    expect(spaceParams('grp')).toEqual({ space: 'grp' });
    expect(spaceParams()).toEqual({});
  });
});

describe('group records decode into the same wealth view', () => {
  it('gives properties and tenancies, none of Personal', () => {
    const w = decodeWealth([prop('b'), prop('a'), rent('t1', '2026-12-05', 100n)]);
    expect(w.properties.map((p) => p.id)).toEqual(['a', 'b']);
    expect(w.investments).toEqual([]);
  });
});

describe('free cap is per own plan', () => {
  it('counts only the properties this partner added', () => {
    const records = [prop('mine', 'me'), prop('theirs1', 'partner'), prop('theirs2', 'partner')];
    expect(ownActiveProperties(records, 'me')).toBe(1);
    expect(ownActiveProperties([prop('theirs', 'partner')], 'me')).toBe(0);
    // A change still in the queue has no author yet: it is this phone's.
    expect(ownActiveProperties([prop('queued')], 'me')).toBe(1);
    expect(ownActiveProperties([prop('old', 'me', 'closed')], 'me')).toBe(0);
  });
});

describe('paid in full dedupes between partners', () => {
  it('uses the occurrence id in a group space, a fresh id otherwise', () => {
    const a = rentEntryId(true, 'rule-1', '2026-12-05', () => 'x');
    const b = rentEntryId(true, 'rule-1', '2026-12-05', () => 'y');
    expect(a).toBe(b);
    expect(a).toBe(recurringOccurrenceId('rule-1', '2026-12-05'));
    expect(rentEntryId(true, 'rule-1', null, () => 'part')).toBe('part');
    expect(rentEntryId(false, 'rule-1', '2026-12-05', () => 'fresh')).toBe('fresh');
  });
});

describe('document sweep', () => {
  it('is gone: folders are deleted only by an explicit property delete', () => {
    const src = readFileSync(new URL('../src/app/rentals/[id].tsx', import.meta.url), 'utf8');
    expect(src).not.toContain('sweepOrphanDocs');
  });
});

describe('household income', () => {
  it('adds this month rent received to the planned income', () => {
    const records = [
      prop('flat'),
      rent('r1', '2026-12-05', 20_000n),
      rent('r2', '2026-12-20', 5_000n),
      rent('old', '2026-11-05', 99n),
      rent('usd', '2026-12-05', 7n, 'USD'),
    ];
    const s = groupRentalsSummary(records, '2026-12', 'INR');
    expect(s).toEqual({ count: 1, received: 25_000n });
    const plans = [{ active: true, currency: 'INR', amount: 100_000n, memberId: 'm' }];
    expect(incomeTotal(plans as never, 'INR') + s.received).toBe(125_000n);
  });
});
