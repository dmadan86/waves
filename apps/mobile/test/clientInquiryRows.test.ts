import { describe, expect, it } from 'vitest';

import type { CompanyClient } from '@waves/core';

import { buildClientRows, tabCounts, type ClientDoc } from '../src/lib/clientRows';

const client = (id: string, over: Partial<CompanyClient> = {}): CompanyClient => ({
  id,
  name: id,
  phone: null,
  need: null,
  source: 'call',
  expectedValueMinor: null,
  address: null,
  email: null,
  companyName: null,
  category: null,
  priority: 'normal',
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
const inq = (id: string, clientId: string, number: number, date: string, over = {}) => ({
  id,
  clientId,
  number,
  title: id,
  details: null,
  expectedValueMinor: 1000n,
  inquiryDate: date,
  rejectedAt: null,
  rejectReason: null,
  createdBy: 'm',
  createdAt: `${date}T00:00:00Z`,
  ...over,
});
const estimate = (clientId: string, inquiryId: string, over: Partial<ClientDoc> = {}) =>
  doc(clientId, { docType: 'estimate', id: `e-${inquiryId}`, status: 'sent', inquiryId, ...over });
const by = (rows: ReturnType<typeof buildClientRows>, id: string) =>
  rows.find((r) => r.client.id === id)!;

describe('client rows with inquiries', () => {
  it('reads like the latest inquiry: quoted, rejected, open', () => {
    const rows = buildClientRows(
      [client('q'), client('r'), client('o')],
      [estimate('q', 'q2'), estimate('r', 'r1')],
      [],
      new Map(),
      [
        inq('q1', 'q', 1, '2026-10-01'),
        inq('q2', 'q', 2, '2026-10-20'),
        inq('r1', 'r', 3, '2026-10-02', { rejectedAt: '2026-10-05' }),
        inq('o1', 'o', 4, '2026-10-03'),
      ],
    );
    expect(by(rows, 'q').status).toBe('quoted');
    expect(by(rows, 'r').status).toBe('rejected');
    expect(by(rows, 'o').status).toBe('inquiry');
    // The older open inquiry of "q" still puts it in the Inquiries tab.
    expect(by(rows, 'q').hasOpenInquiry).toBe(true);
    expect(by(rows, 'r').hasOpenInquiry).toBe(false);
    expect(tabCounts(rows).inquiry).toBe(2);
  });

  it('a won inquiry shows what is owed, else a plain client; the amount follows the inquiry', () => {
    const rows = buildClientRows(
      [client('w'), client('a')],
      [
        doc('w', {
          id: 'b1',
          inquiryId: 'w1',
          status: 'unpaid',
          totalMinor: 9000n,
          paidMinor: 1000n,
        }),
        estimate('a', 'a1', { status: 'accepted', totalMinor: 7000n }),
      ],
      [],
      new Map(),
      [inq('w1', 'w', 1, '2026-10-01'), inq('a1', 'a', 2, '2026-10-02')],
    );
    expect(by(rows, 'w').status).toBe('part_paid');
    expect(by(rows, 'w').amountMinor).toBe(8000n);
    expect(by(rows, 'a').status).toBe('client');
    expect(by(rows, 'a').amountMinor).toBe(7000n);
  });

  it('a lost client stays lost; a client with no inquiries keeps the old reading and tab', () => {
    const rows = buildClientRows([client('l', { stage: 'lost' }), client('x')], [], [], new Map(), [
      inq('l1', 'l', 1, '2026-10-01'),
    ]);
    expect(by(rows, 'l').status).toBe('lost');
    expect(by(rows, 'x').status).toBe('inquiry');
    expect(by(rows, 'x').inquiryCount).toBe(0);
    expect(tabCounts([by(rows, 'x')]).inquiry).toBe(1);
  });
});
