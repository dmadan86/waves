import { describe, expect, it } from 'vitest';

import { planSummary } from '@/lib/planSummary';
import { upcomingVendorPayments, type VendorCandidate } from '@/lib/eventVendors';

describe('planSummary', () => {
  it('no budget is never over budget', () => {
    expect(planSummary(0n, 1000000n)).toMatchObject({
      state: 'none',
      gapMinor: 0n,
      percentUsed: 0,
    });
    expect(planSummary(-5n, 10n).state).toBe('none');
  });
  it('under budget shows what is left', () => {
    expect(planSummary(10000n, 2500n)).toEqual({
      state: 'left',
      plannedMinor: 10000n,
      spentMinor: 2500n,
      gapMinor: 7500n,
      percentUsed: 25,
    });
  });
  it('exactly on budget is left 0, not over', () => {
    expect(planSummary(10000n, 10000n)).toMatchObject({
      state: 'left',
      gapMinor: 0n,
      percentUsed: 100,
    });
  });
  it('over only when a budget exists and spend exceeds it', () => {
    expect(planSummary(10000n, 15000n)).toMatchObject({
      state: 'over',
      gapMinor: 5000n,
      percentUsed: 100,
    });
  });
});

const c = (o: Partial<VendorCandidate>): VendorCandidate => ({
  expenseId: 'e',
  description: 'Decor',
  currency: 'INR',
  amountMinor: 1000000n,
  isDeposit: true,
  balanceDueMinor: 300000n,
  balanceDueDate: '2026-10-09',
  subEventId: 'sangeet',
  payerMemberId: 'm',
  expenseDate: '2026-10-05',
  ...o,
});

describe('upcomingVendorPayments', () => {
  const today = '2026-10-05';
  it('lists balances owed with vendor, sub-event and due date, never paid advances', () => {
    const rows = upcomingVendorPayments(
      [
        c({ expenseId: 'owed' }),
        c({ expenseId: 'paid', description: 'Paid vendor', balanceDueMinor: 0n }),
        c({ expenseId: 'plain', description: 'Event payment', isDeposit: false }),
      ],
      today,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      expenseId: 'owed',
      vendorName: 'Decor',
      subEventId: 'sangeet',
      balanceMinor: 300000n,
      dueDate: '2026-10-09',
      overdue: false,
      dueSoon: true,
    });
  });
  it('sorts by due date with undated last and flags overdue', () => {
    const rows = upcomingVendorPayments(
      [
        c({ expenseId: 'none', description: 'A', balanceDueDate: null }),
        c({ expenseId: 'late', description: 'B', balanceDueDate: '2026-12-01' }),
        c({ expenseId: 'over', description: 'C', balanceDueDate: '2026-10-01' }),
      ],
      today,
    );
    expect(rows.map((r) => r.expenseId)).toEqual(['over', 'late', 'none']);
    expect(rows[0]!.overdue).toBe(true);
  });
  it('is empty when nothing is due', () => {
    expect(upcomingVendorPayments([c({ balanceDueMinor: 0n })], today)).toEqual([]);
  });
});
