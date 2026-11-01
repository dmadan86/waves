import { describe, expect, it } from 'vitest';

import type { CompanyClient } from '@waves/core';

import {
  buildClientRows,
  daysAgo,
  listClientRows,
  tabCounts,
  type ClientDoc,
} from '../src/lib/clientRows';

const client = (id: string, over: Partial<CompanyClient> = {}): CompanyClient => ({
  id,
  name: id,
  phone: null,
  need: null,
  source: 'call',
  expectedValueMinor: null,
  address: null,
  stage: 'inquiry',
  lostReason: null,
  ownerMemberId: null,
  createdBy: 'm',
  createdAt: '2026-10-01T10:00:00Z',
  ...over,
});
const doc = (clientId: string, over: Partial<ClientDoc>): ClientDoc => ({
  docType: 'bill',
  number: 1,
  docDate: '2026-10-10',
  totalMinor: 10000n,
  paidMinor: 0n,
  payments: [],
  clientId,
  deleted: false,
  ...over,
});

describe('buildClientRows', () => {
  const rows = buildClientRows(
    [
      client('inq'),
      client('quo'),
      client('unp'),
      client('part'),
      client('paid'),
      client('lost', { stage: 'lost' }),
    ],
    [
      doc('quo', { docType: 'estimate', number: 118, totalMinor: 4500n }),
      doc('unp', { number: 1024, totalMinor: 2400n }),
      doc('part', {
        totalMinor: 1000n,
        paidMinor: 400n,
        payments: [{ id: 'p', amountMinor: 400n, paidOn: '2026-10-20' }],
      }),
      doc('paid', { totalMinor: 500n, paidMinor: 500n }),
      doc('paid', { deleted: true, docDate: '2026-10-30', totalMinor: 9n }),
    ],
  );
  const by = (id: string) => rows.find((r) => r.client.id === id)!;

  it('derives status', () => {
    expect(rows.map((r) => r.status)).toEqual([
      'inquiry',
      'quoted',
      'unpaid',
      'part_paid',
      'paid',
      'lost',
    ]);
  });
  it('amount is the due, else the latest total, else null', () => {
    expect(by('part').amountMinor).toBe(600n);
    expect(by('quo').amountMinor).toBe(4500n);
    expect(by('paid').amountMinor).toBe(500n);
    expect(by('inq').amountMinor).toBeNull();
  });
  it('last activity is the latest doc, payment or creation; deleted docs ignored', () => {
    expect(by('inq').lastDay).toBe('2026-10-01');
    expect(by('part').lastDay).toBe('2026-10-20');
    expect(by('paid').lastDay).toBe('2026-10-10');
    expect(by('unp').latest).toEqual({ type: 'bill', number: 1024 });
  });
  it('counts tabs without lost clients', () => {
    expect(tabCounts(rows)).toEqual({ all: 5, inquiry: 1, quote: 1, invoice: 3 });
  });
  it('lists by status, range and sort', () => {
    const o = {
      tab: 'all',
      status: null,
      range: 'all',
      sort: 'amount',
      query: '',
      today: '2026-10-25',
    } as const;
    expect(listClientRows(rows, o).map((r) => r.client.id)).toEqual([
      'quo',
      'unp',
      'part',
      'paid',
      'inq',
    ]);
    expect(listClientRows(rows, { ...o, status: 'lost' }).map((r) => r.client.id)).toEqual([
      'lost',
    ]);
    expect(
      listClientRows(rows, { ...o, range: 'month', sort: 'recent', today: '2026-11-02' }),
    ).toEqual([]);
  });
  it('daysAgo never goes negative', () => {
    expect(daysAgo('2026-10-23', '2026-10-25')).toBe(2);
    expect(daysAgo('2026-10-30', '2026-10-25')).toBe(0);
  });
});
