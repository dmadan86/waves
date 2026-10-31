import { describe, expect, it } from 'vitest';
import { companyEntryFromRow, owedByMember } from '../src';

const row = (id: string, member: string, kind: string, amount: string, extra = {}) =>
  companyEntryFromRow({
    id,
    group_id: 'g',
    member_id: member,
    paid_by_company: false,
    entry_kind: kind,
    category: 'travel',
    amount,
    currency: 'INR',
    occurred_on: '2026-10-05',
    status: 'approved',
    ...extra,
  });

describe('owedByMember', () => {
  it('lists only people the company owes, net, skipping other ids and deleted rows', () => {
    const e = [
      row('a', 'm1', 'expense', '500'),
      row('b', 'm1', 'expense', '700'),
      row('c', 'm2', 'expense', '900'),
      row('d', 'm3', 'expense', '100', { deleted_at: '2026-10-06T00:00:00Z' }),
    ];
    const owed = owedByMember(e, ['m1', 'm3']);
    expect(owed.get('m1')).toBe(1200n);
    expect(owed.has('m2')).toBe(false);
    expect(owed.has('m3')).toBe(false);
    expect(owedByMember([], ['m1']).size).toBe(0);
  });
});
