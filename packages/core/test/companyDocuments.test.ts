import { describe, expect, it } from 'vitest';

import {
  billStatus,
  computeDocTotals,
  docNumberLabel,
  formatQty,
  materialiseCompanyDocs,
  parseQtyMilli,
  unpaidBills,
  unpaidBillsTotal,
  validateDoc,
  validatePayment,
  SyncTable,
  type MirrorState,
  type QueuedMutation,
} from '../src';

const G = 'g1';
const ME = 'm1';
const state = (rows: Record<string, unknown>[]): MirrorState =>
  ({
    tables: { [SyncTable.CompanyDocuments]: Object.fromEntries(rows.map((r) => [r.id, r])) },
    cursors: {},
  }) as unknown as MirrorState;
const q = (seq: number, kind: string, payload: unknown): QueuedMutation =>
  ({ seq, kind, groupId: G, payload, clientCreatedAt: '2026-11-14T00:00:00Z' }) as never;
const opts = { groupId: G, currency: 'INR', viewerMemberId: ME };
const row = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  group_id: G,
  doc_type: 'estimate',
  number: 1,
  customer_name: 'Ravi',
  customer_phone: null,
  doc_date: '2026-11-14',
  items: [{ description: 'Paint', qtyMilli: 2500, rateMinor: 333, amountMinor: 833 }],
  discount_minor: '0',
  total_minor: '833',
  currency: 'INR',
  notes: null,
  status: 'draft',
  payments: [],
  paid_minor: '0',
  created_by: ME,
  deleted_at: null,
  ...over,
});

describe('totals', () => {
  it('qty x rate rounds half up in minor units', () => {
    expect(computeDocTotals([{ qtyMilli: 2500n, rateMinor: 333n }], 0n).totalMinor).toBe(833n);
    expect(computeDocTotals([{ qtyMilli: 1n, rateMinor: 499n }], 0n).totalMinor).toBe(0n);
    expect(computeDocTotals([{ qtyMilli: 1n, rateMinor: 500n }], 0n).totalMinor).toBe(1n);
    // bigint never loses precision, far past 2^53 (the server caps a document at 9e15)
    expect(
      computeDocTotals([{ qtyMilli: 999999999n, rateMinor: 9999999999999n }], 0n).totalMinor,
    ).toBe(9999999989999000000n);
  });
  it('subtracts a discount amount and clamps it', () => {
    const items = [
      { qtyMilli: 2500n, rateMinor: 333n },
      { qtyMilli: 1000n, rateMinor: 10000n },
    ];
    expect(computeDocTotals(items, 100n).totalMinor).toBe(10733n);
    expect(computeDocTotals(items, 10n ** 9n).totalMinor).toBe(0n);
  });
  it('parses quantities', () => {
    expect(parseQtyMilli('2.5')).toBe(2500n);
    expect(parseQtyMilli('3')).toBe(3000n);
    expect(parseQtyMilli('0')).toBeNull();
    expect(parseQtyMilli('1.2345')).toBeNull();
    expect(formatQty(2500n)).toBe('2.5');
    expect(formatQty(3000n)).toBe('3');
  });
  it('validates', () => {
    const item = { description: 'x', qtyMilli: 1000n, rateMinor: 100n };
    expect(validateDoc({ customerName: '', items: [item], discountMinor: 0n })).toBe('name');
    expect(validateDoc({ customerName: 'a', items: [], discountMinor: 0n })).toBe('items');
    expect(validateDoc({ customerName: 'a', items: [item], discountMinor: 100n })).toBe('discount');
    expect(validateDoc({ customerName: 'a', items: [item], discountMinor: 10n }, 91n)).toBe(
      'below_paid',
    );
    expect(validateDoc({ customerName: 'a', items: [item], discountMinor: 10n })).toBeNull();
  });
});

describe('bills', () => {
  it('status follows part payments', () => {
    expect(billStatus(1000n, 0n)).toBe('unpaid');
    expect(billStatus(1000n, 400n)).toBe('part_paid');
    expect(billStatus(1000n, 1000n)).toBe('paid');
    expect(validatePayment(1000n, 400n, 700n)).toBe('over');
    expect(validatePayment(1000n, 400n, 0n)).toBe('amount');
    expect(validatePayment(1000n, 400n, 600n)).toBeNull();
  });
  it('numbers read EST-0001 / BILL-0001', () => {
    expect(docNumberLabel('estimate', 1)).toBe('EST-0001');
    expect(docNumberLabel('bill', 12)).toBe('BILL-0012');
    expect(docNumberLabel('bill', null)).toBe('BILL');
  });
  it('queued save, convert and payments overlay the pulled rows', () => {
    const queue = [
      q(1, 'company_doc.convert', { docId: 'd1', billId: 'b1' }),
      q(2, 'company_doc.payment', {
        docId: 'b1',
        paymentId: 'p1',
        amountMinor: '300',
        paidOn: '2026-11-15',
      }),
      q(3, 'company_doc.payment', {
        docId: 'b1',
        paymentId: 'p1',
        amountMinor: '300',
        paidOn: '2026-11-15',
      }),
    ];
    const docs = materialiseCompanyDocs(state([row()]), queue, opts);
    const bill = docs.find((d) => d.id === 'b1')!;
    expect(bill.docType).toBe('bill');
    expect(bill.paidMinor).toBe(300n);
    expect(bill.status).toBe('part_paid');
    expect(docs.find((d) => d.id === 'd1')!.status).toBe('accepted');
    expect(unpaidBills(docs).map((d) => d.id)).toEqual(['b1']);
    expect(unpaidBillsTotal(docs)).toBe(533n);
  });
  it('a new offline document has no number and is computed locally', () => {
    const docs = materialiseCompanyDocs(
      state([]),
      [
        q(1, 'company_doc.save', {
          docId: 'n1',
          data: {
            docType: 'bill',
            customerName: ' Zed ',
            customerPhone: null,
            docDate: '2026-11-14',
            items: [{ description: 'A', qtyMilli: '2000', rateMinor: '250' }],
            discountMinor: '100',
            notes: null,
          },
        }),
      ],
      opts,
    );
    expect(docs[0]).toMatchObject({
      number: null,
      totalMinor: 400n,
      status: 'unpaid',
      createdBy: ME,
      customerName: 'Zed',
    });
  });
  it('a removed document disappears', () => {
    expect(
      materialiseCompanyDocs(state([row()]), [q(1, 'company_doc.void', { docId: 'd1' })], opts),
    ).toHaveLength(0);
  });
});
