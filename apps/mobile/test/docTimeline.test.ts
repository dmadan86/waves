import { describe, expect, it } from 'vitest';
import type { MirrorCompanyDoc } from '@waves/core';
import { closingStamp, docTimeline } from '../src/lib/docTimeline';

const base = {
  id: 'd',
  groupId: 'g',
  docType: 'estimate',
  number: 1,
  customerName: 'A',
  customerPhone: null,
  docDate: '2026-10-29',
  items: [],
  discountMinor: 0n,
  totalMinor: 0n,
  currency: 'INR',
  notes: null,
  status: 'sent',
  payments: [],
  paidMinor: 0n,
  convertedTo: null,
  convertedFrom: null,
  createdBy: 'm1',
  createdAt: '2026-10-29T10:24:00Z',
  updatedAt: '2026-10-29T10:46:00Z',
  updatedBy: 'm2',
  deleted: false,
  pending: false,
} as MirrorCompanyDoc;

describe('docTimeline', () => {
  it('lists created and the current status, newest first', () => {
    expect(docTimeline(base).map((e) => e.kind)).toEqual(['sent', 'created']);
  });
  it('leaves out events without a time and skips draft', () => {
    expect(docTimeline({ ...base, status: 'draft', createdAt: null }).length).toBe(0);
  });
  it('adds payments for a bill and never a status event', () => {
    const bill = {
      ...base,
      docType: 'bill',
      status: 'part_paid',
      payments: [{ id: 'p', amountMinor: 5n, paidOn: '2026-10-30' }],
    } as MirrorCompanyDoc;
    expect(docTimeline(bill).map((e) => e.kind)).toEqual(['payment', 'created']);
  });
  it('stamps only closed documents', () => {
    expect(closingStamp(base)).toBeNull();
    expect(closingStamp({ ...base, status: 'accepted' })?.kind).toBe('accepted');
    expect(closingStamp({ ...base, docType: 'bill', status: 'paid' })?.kind).toBe('paid');
  });
});
