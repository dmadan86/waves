import { describe, expect, it } from 'vitest';
import { clientHistory, matchClients, normalizePhone } from '../src/lib/clientMatch';

const c = (id: string, name: string, phone: string | null) => ({ id, name, phone });
const all = [
  c('a', 'Ravi Kumar', '+91 98765 43210'),
  c('b', 'Raviraj Stores', '09123456780'),
  c('c', 'Meena', '9876543210'),
  c('d', 'Ravindra', null),
  c('e', 'Ravi Shankar', '8000000001'),
];

describe('normalizePhone', () => {
  it('strips spaces, +91 and a leading 0', () => {
    expect(normalizePhone('+91 98765-43210')).toBe('9876543210');
    expect(normalizePhone('09876543210')).toBe('9876543210');
    expect(normalizePhone(null)).toBe('');
  });
});

describe('matchClients', () => {
  it('matches full and partial (ending) digits, needs 6+', () => {
    expect(matchClients(all, { name: '', phone: '+91 9876543210' }).map((x) => x.id)).toEqual([
      'a',
      'c',
    ]);
    expect(matchClients(all, { name: '', phone: '543210' }).map((x) => x.id)).toEqual(['a', 'c']);
    expect(matchClients(all, { name: '', phone: '43210' })).toEqual([]);
  });
  it('matches names by case-insensitive contains from 3 characters', () => {
    expect(matchClients(all, { name: 'RAV', phone: '' }).map((x) => x.id)).toEqual(['a', 'b', 'd']);
    expect(matchClients(all, { name: 'ra', phone: '' })).toEqual([]);
  });
  it('puts phone matches first and caps at 3', () => {
    const r = matchClients(all, { name: 'rav', phone: '8000000001' });
    expect(r.map((x) => x.id)).toEqual(['e', 'a', 'b']);
  });
});

describe('clientHistory', () => {
  it('counts and finds the newest item', () => {
    const h = clientHistory(
      [{ inquiryDate: '2026-11-01', expectedValueMinor: 500n }],
      [
        { docType: 'estimate', docDate: '2026-11-05', totalMinor: 900n },
        { docType: 'bill', docDate: '2026-11-09', totalMinor: 1200n, deleted: true },
      ],
      2,
    );
    expect(h).toMatchObject({ inquiries: 1, estimates: 1, bills: 0, complaints: 2 });
    expect(h.last).toEqual({ kind: 'estimate', day: '2026-11-05', amountMinor: 900n });
  });
});
