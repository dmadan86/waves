import { describe, expect, it } from 'vitest';
import {
  buildReceipt,
  buildVendorStatement,
  filterVendorRows,
  paymentOutcome,
  inVendorPeriod,
  vendorDashboard,
  vendorReceiptCount,
  vendorOverdue,
  type Vendor,
  type VendorLine,
} from '../src';

const vendor = (id: string, name: string, phone: string | null = null): Vendor => ({
  id,
  name,
  phone,
  category: null,
  addedBy: 'm',
  memberId: null,
  version: 1,
  deleted: false,
});
let n = 0;
const line = (
  vendorId: string,
  kind: VendorLine['kind'],
  amount: number,
  on: string,
  extra: Partial<VendorLine> = {},
): VendorLine => ({
  id: `l${++n}`,
  vendorId,
  kind,
  amount: BigInt(amount),
  occurredOn: on,
  note: null,
  status: 'approved',
  createdBy: 'm',
  fundingManagerId: null,
  receivedAt: null,
  reviewNote: null,
  version: 1,
  createdAt: `2026-11-01T00:00:${String(n).padStart(2, '0')}Z`,
  deleted: false,
  ...extra,
});
const today = '2026-11-15';

const vendors = [
  vendor('a', 'Asha Traders', '98'),
  vendor('b', 'Bala'),
  vendor('c', 'Chitra'),
  vendor('d', 'Dev'),
];
const lines = [
  line('a', 'bill', 1000, '2026-10-01', { dueOn: '2026-10-10' }),
  line('a', 'payment', 300, '2026-11-02', { receiptNo: 1 }),
  line('b', 'bill', 500, '2026-11-01', { dueOn: '2026-12-01' }),
  line('c', 'bill', 200, '2026-11-01'),
  line('c', 'payment', 200, '2026-10-20'),
  line('d', 'bill', 900, '2026-11-10', { status: 'pending' }),
  line('d', 'payment', 50, '2026-11-11', { deleted: true }),
];

describe('vendor dashboard', () => {
  const d = vendorDashboard(vendors, lines, today);
  it('sums positive balances, overdue vendors, this month payments, bills to review', () => {
    expect(d.totalToPay).toBe(700n + 500n);
    expect(d.overdueVendors).toBe(1);
    expect(d.paidThisMonth).toBe(300n);
    expect(d.billsToReview).toBe(1);
  });
  it('statuses and counts', () => {
    const s = Object.fromEntries(d.rows.map((r) => [r.vendor.id, r.status]));
    expect(s).toEqual({ a: 'overdue', b: 'toPay', c: 'settled', d: 'toReview' });
    expect(d.counts).toMatchObject({ all: 4, toPay: 2, settled: 2, toReview: 1, overdue: 1 });
  });
  it('a bill past due is not overdue once paid off, nor when only pending', () => {
    const paid = vendorDashboard(
      [vendors[0]!],
      [lines[0]!, line('a', 'payment', 1000, '2026-11-01')],
      today,
    );
    expect(paid.overdueVendors).toBe(0);
  });
  it('payments settle the oldest bill first, so a paid overdue bill is not overdue', () => {
    const l = [
      line('a', 'bill', 100, '2026-09-01', { dueOn: '2026-09-10' }),
      line('a', 'payment', 100, '2026-09-20'),
      line('a', 'bill', 200, '2026-11-01', { dueOn: '2026-12-01' }),
    ];
    expect(vendorDashboard([vendors[0]!], l, today).overdueVendors).toBe(0);
    expect(vendorOverdue(l.slice(0, 1), today)).toBe(100n);
  });
  it('filters and searches name or phone', () => {
    expect(filterVendorRows(d.rows, 'toPay').map((r) => r.vendor.id)).toEqual(['a', 'b']);
    expect(filterVendorRows(d.rows, 'all', 'ASHA')).toHaveLength(1);
    expect(filterVendorRows(d.rows, 'all', '98')).toHaveLength(1);
  });
});

describe('vendor periods, receipts and stat filters', () => {
  it('periods', () => {
    expect(inVendorPeriod('2026-10-31', 'lastMonth', '2026-11-05')).toBe(true);
    expect(inVendorPeriod('2026-12-31', 'lastMonth', '2027-01-05')).toBe(true);
    expect(inVendorPeriod('2026-11-05', 'lastMonth', '2026-11-05')).toBe(false);
    expect(inVendorPeriod('2026-01-01', 'year', '2026-11-05')).toBe(true);
    expect(inVendorPeriod('2025-12-31', 'year', '2026-11-05')).toBe(false);
    expect(inVendorPeriod('2001-01-01', 'all', '2026-11-05')).toBe(true);
  });
  it('counts only live approved payments in the period, per row and in total', () => {
    const l = [
      line('a', 'payment', 5, '2026-11-02'),
      line('a', 'payment', 5, '2026-10-02'),
      line('a', 'bill', 5, '2026-11-02'),
      line('a', 'payment', 5, '2026-11-03', { deleted: true }),
    ];
    expect(vendorReceiptCount(l, 'month', '2026-11-05')).toBe(1);
    expect(vendorReceiptCount(l, 'all', '2026-11-05')).toBe(2);
    const d = vendorDashboard([vendors[0]!, vendors[1]!], l, '2026-11-05', 'all');
    expect(d.receipts).toBe(2);
    expect(filterVendorRows(d.rows, 'receipts').map((r) => r.vendor.id)).toEqual(['a']);
  });
  it('overdue filter keeps vendors with overdue money', () => {
    expect(
      filterVendorRows(vendorDashboard(vendors, lines, today).rows, 'overdue').map(
        (r) => r.vendor.id,
      ),
    ).toEqual(['a']);
  });
});

describe('payment outcome, receipt, statement', () => {
  it('overpayment becomes advance', () => {
    expect(paymentOutcome(700n, 200n)).toEqual({ remaining: 500n, advance: 0n });
    expect(paymentOutcome(700n, 900n)).toEqual({ remaining: -200n, advance: 200n });
  });
  it('receipt shows balance after that payment', () => {
    const r = buildReceipt(
      lines[1]!,
      vendors[0]!,
      lines.filter((l) => l.vendorId === 'a'),
    );
    expect(r.balanceAfter).toBe(700n);
    expect(r.receiptNo).toBe(1);
  });
  it('statement runs oldest first and skips pending/voided lines', () => {
    const s = buildVendorStatement(lines.filter((l) => l.vendorId === 'd' || l.vendorId === 'a'));
    expect(s.rows.map((r) => r.balance)).toEqual([1000n, 700n]);
    expect(s.balance).toBe(700n);
  });
});
