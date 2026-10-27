import { describe, expect, it } from 'vitest';
import {
  filterOtherTransfers,
  memberBalanceStatus,
  sortPeopleDebts,
} from '../src/lib/groupBalanceList';

const transfers = [
  { from: 'a', to: 'b', amount: 100n, currency: 'INR' },
  { from: 'c', to: 'a', amount: 200n, currency: 'USD' },
  { from: 'b', to: 'c', amount: 300n, currency: 'INR' },
];

describe('balance list helpers', () => {
  it('preserves currency-aware amount order and sorts names without mutating input', () => {
    const people = [
      { memberId: 'b', amounts: [] },
      { memberId: 'a', amounts: [] },
    ];
    expect(sortPeopleDebts(people, 'amount', (id) => id, 'en')).toEqual(people);
    expect(sortPeopleDebts(people, 'name', (id) => id, 'en').map((p) => p.memberId)).toEqual([
      'a',
      'b',
    ]);
    expect(people[0].memberId).toBe('b');
  });
  it('filters either end of a transfer, with All retaining every currency', () => {
    expect(filterOtherTransfers(transfers, null)).toEqual(transfers);
    expect(filterOtherTransfers(transfers, 'a')).toEqual(transfers.slice(0, 2));
    expect(filterOtherTransfers(transfers, 'missing')).toEqual([]);
  });
  it('uses net direction, viewer identity and a direct debt to choose status', () => {
    expect(memberBalanceStatus(0n, false, true)).toBe('balanceSettled');
    expect(memberBalanceStatus(10n, true, false)).toBe('balanceIsOwed');
    expect(memberBalanceStatus(10n, false, false)).toBe('balanceIsOwed');
    expect(memberBalanceStatus(-10n, false, true)).toBe('balanceOwesYou');
    expect(memberBalanceStatus(-10n, false, false)).toBe('balanceOwes');
    expect(memberBalanceStatus(-10n, true, true)).toBe('balanceOwes');
  });
});
