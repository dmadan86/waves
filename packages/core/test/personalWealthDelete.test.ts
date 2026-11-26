import { describe, expect, it } from 'vitest';

import { linkedPersonalTxnIds } from '../src/personal/wealth';
import { encodeRecurring, encodeTenancy } from '../src/personal/types';
import { monthlyIncomeEntries, monthlySummary } from '../src/personal/compute';

describe('deleting a personal investment, rental, or loan', () => {
  it('selects every linked entry and leaves unrelated and already-unlinked entries alone', () => {
    const txns = [
      { id: 'deposit', investmentId: 'i1', propertyId: null, loanId: null },
      { id: 'rent', investmentId: null, propertyId: 'p1', loanId: null },
      { id: 'emi', investmentId: null, propertyId: null, loanId: 'l1' },
      { id: 'other', investmentId: null, propertyId: null, loanId: null },
      { id: 'other-investment', investmentId: 'i2', propertyId: null, loanId: null },
    ];
    expect(linkedPersonalTxnIds(txns, { investmentId: 'i1' })).toEqual(['deposit']);
    expect(linkedPersonalTxnIds(txns, { propertyId: 'p1' })).toEqual(['rent']);
    expect(linkedPersonalTxnIds(txns, { loanId: 'l1' })).toEqual(['emi']);
    expect(linkedPersonalTxnIds([], { propertyId: 'deleted' })).toEqual([]);
  });

  it('shows the same ordinary income entries in the monthly total and its drill-down', () => {
    const txns = [
      {
        id: 'salary',
        kind: 'income',
        amount: 950n,
        currency: 'INR',
        category: 'inc.salary',
        date: '2026-11-02',
        investmentId: null,
      },
      {
        id: 'withdrawal',
        kind: 'income',
        amount: 100n,
        currency: 'INR',
        category: 'inv.deposit',
        date: '2026-11-02',
        investmentId: 'i',
      },
      {
        id: 'usd',
        kind: 'income',
        amount: 500n,
        currency: 'USD',
        category: 'inc.salary',
        date: '2026-11-02',
      },
      {
        id: 'last-month',
        kind: 'income',
        amount: 300n,
        currency: 'INR',
        category: 'inc.salary',
        date: '2026-10-31',
      },
    ] as never[];
    expect(monthlySummary(txns, '2026-11', 'INR').income).toBe(950n);
    expect(monthlyIncomeEntries(txns, '2026-11', 'INR').map((t) => t.id)).toEqual(['salary']);
  });

  it('saves the tenancy name and rent amount on their synced records', () => {
    const tenancy = encodeTenancy({
      propertyId: 'p1',
      unit: null,
      tenantName: 'Asha',
      tenantPhone: null,
      depositHeld: 0n,
      rentFrequency: 'monthly',
      startDate: '2026-11-26',
      endDate: null,
      escalationPct: null,
      status: 'active',
      endedOn: null,
      depositReturned: null,
      depositKept: null,
      note: null,
    });
    const recurring = encodeRecurring({
      txnKind: 'income',
      amount: 80000n,
      currency: 'INR',
      category: 'inc.rent',
      note: 'Rent · Flat',
      cadence: 'monthly',
      interval: 1,
      secondDay: null,
      anchorDate: '2026-11-26',
      nextDate: '2026-11-26',
      endDate: null,
      autoPost: false,
      active: true,
      tenancyId: 't1',
      investmentId: null,
    });
    expect(tenancy.tenantName).toBe('Asha');
    expect(recurring.amount).toBe('80000');
  });
});
