import { describe, expect, it } from 'vitest';
import { deriveMoneyDates, type CompanyEntry } from '../src/company';

const entry = (
  id: string,
  kind: CompanyEntry['kind'],
  memberId: string,
  occurredOn: string,
  amount: bigint,
  extra: Partial<CompanyEntry> = {},
): CompanyEntry => ({
  id,
  groupId: 'g',
  memberId,
  paidByCompany: false,
  kind,
  category: null,
  amount,
  currency: 'INR',
  calcMode: 'typed',
  days: null,
  rateMinor: null,
  occurredOn,
  direction: null,
  status: 'approved',
  note: null,
  reviewNote: null,
  vendor: null,
  gstin: null,
  invoiceNo: null,
  gstRateBps: null,
  gstAmount: null,
  distanceKm: null,
  fromText: null,
  toText: null,
  reimbursementId: null,
  coversClaims: false,
  projectId: null,
  fundingManagerId: null,
  grossMinor: null,
  claimsMinor: null,
  recoveryMinor: null,
  wageRunId: null,
  periodStart: null,
  periodEnd: null,
  version: 1,
  createdAt: '',
  createdBy: null,
  deleted: false,
  ...extra,
});

describe('deriveMoneyDates', () => {
  it('derives wages, unpaid vendor/customer bills and outstanding advances, sorts, and flags overdue', () => {
    const entries = [entry('a1', 'advance', 'm1', '2026-10-01', 500n)];
    const dates = deriveMoneyDates(
      {
        currency: 'INR',
        entries,
        people: [{ id: 'm1', name: 'Asha' }],
        vendors: [{ id: 'v1', name: 'Builder', memberId: null }],
        vendorLines: [
          {
            id: 'vb',
            vendorId: 'v1',
            kind: 'bill',
            amount: 200n,
            occurredOn: '2026-10-25',
            status: 'approved',
            deleted: false,
          },
        ],
        documents: [
          {
            id: 'd1',
            docType: 'bill',
            customerName: 'Ravi',
            number: 3,
            docDate: '2026-10-30',
            totalMinor: 700n,
            paidMinor: 200n,
            currency: 'INR',
            deleted: false,
          },
        ],
      },
      '2026-10-30',
    );
    expect(dates.map((d) => d.kind)).toEqual(['advance', 'vendor_bill', 'customer_bill', 'wage']);
    expect(dates[0]?.amountMinor).toBe(500n);
    expect(dates[0]?.overdue).toBe(true);
    expect(dates[3]?.day).toBe('2026-10-30');
  });

  it('excludes paid bills and advances fully recovered in a wage payment', () => {
    const entries = [
      entry('a', 'advance', 'm1', '2026-10-01', 500n),
      entry('p', 'wage_payment', 'm1', '2026-10-20', 500n, { recoveryMinor: 500n }),
    ];
    const dates = deriveMoneyDates(
      {
        currency: 'INR',
        entries,
        vendorLines: [
          {
            id: 'paid',
            vendorId: 'v',
            kind: 'bill',
            amount: 10n,
            occurredOn: '2026-10-01',
            status: 'approved',
            deleted: false,
          },
          {
            id: 'pay',
            vendorId: 'v',
            kind: 'payment',
            amount: 10n,
            occurredOn: '2026-10-02',
            status: 'approved',
            deleted: false,
          },
        ],
        vendors: [{ id: 'v', name: 'Vendor', memberId: null }],
        documents: [
          {
            id: 'd',
            docType: 'bill',
            customerName: 'Customer',
            number: null,
            docDate: '2026-10-10',
            totalMinor: 100n,
            paidMinor: 100n,
            currency: 'INR',
            deleted: false,
          },
        ],
      },
      '2026-10-30',
    );
    expect(dates).toEqual([]);
  });

  it('shows one balance row per vendor and ignores rejected bills', () => {
    const dates = deriveMoneyDates(
      {
        currency: 'INR',
        vendors: [{ id: 'v', name: 'Vendor', memberId: null }],
        vendorLines: [
          {
            id: 'z',
            vendorId: 'v',
            kind: 'bill',
            amount: 10n,
            occurredOn: '2026-10-30',
            status: 'approved',
            deleted: false,
          },
          {
            id: 'a',
            vendorId: 'v',
            kind: 'bill',
            amount: 10n,
            occurredOn: '2026-10-30',
            status: 'approved',
            deleted: false,
          },
          {
            id: 'r',
            vendorId: 'v',
            kind: 'bill',
            amount: 10n,
            occurredOn: '2026-10-30',
            status: 'rejected',
            deleted: false,
          },
        ],
      },
      '2026-10-30',
    );
    expect(dates.map((d) => [d.id, d.amountMinor])).toEqual([['vendor_bill:v', 20n]]);
  });
});
