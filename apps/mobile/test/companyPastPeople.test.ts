import { describe, expect, it } from 'vitest';

import { foldPastPeople, searchPastPeople, type PastPersonRow } from '../src/lib/companyPastPeople';

const row = (id: string, name: string, company: string, extra: Partial<PastPersonRow> = {}) => ({
  source_group_id: `g-${company}`,
  source_group_name: company,
  source_member_id: id,
  profile_id: null,
  display_name: name,
  phone: null,
  email: null,
  is_placeholder: true,
  ...extra,
});

describe('foldPastPeople', () => {
  it('folds the same account across companies and lists both', () => {
    const out = foldPastPeople([
      row('1', 'Ravi', 'Acme', { profile_id: 'p1', is_placeholder: false }),
      row('2', 'Ravi K', 'Beta', { profile_id: 'p1', is_placeholder: false }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.sourceMemberIds).toEqual(['1', '2']);
    expect(out[0]!.companies).toEqual(['Acme', 'Beta']);
  });

  it('folds by phone digits and by email, not by name', () => {
    const out = foldPastPeople([
      row('1', 'Sita', 'Acme', { phone: '+91 98765 43210' }),
      row('2', 'S.', 'Beta', { phone: '+919876543210', email: 'S@x.com' }),
      row('3', 'Other', 'Beta', { email: 's@x.com' }),
      row('4', 'Sita', 'Beta'),
    ]);
    expect(out.map((p) => p.sourceMemberIds)).toEqual([['1', '2', '3'], ['4']]);
    expect(out[0]!.email).toBe('S@x.com');
  });
});

describe('foldPastPeople bridges', () => {
  it('merges rows linked only through a third row', () => {
    const out = foldPastPeople([
      row('1', 'A', 'Acme', { phone: '+911111111111' }),
      row('2', 'A', 'Beta', { email: 'a@x.com' }),
      row('3', 'A', 'Gamma', { phone: '+911111111111', email: 'a@x.com' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.sourceMemberIds).toEqual(['1', '2', '3']);
  });
});

describe('searchPastPeople', () => {
  const people = foldPastPeople([
    row('1', 'Ravi', 'Acme Traders', { phone: '+919876543210' }),
    row('2', 'Meena', 'Beta'),
  ]);
  it('matches name, company and phone; empty returns all', () => {
    expect(searchPastPeople(people, '')).toHaveLength(2);
    expect(searchPastPeople(people, 'rav').map((p) => p.name)).toEqual(['Ravi']);
    expect(searchPastPeople(people, 'beta').map((p) => p.name)).toEqual(['Meena']);
    expect(searchPastPeople(people, '98765').map((p) => p.name)).toEqual(['Ravi']);
  });
});
