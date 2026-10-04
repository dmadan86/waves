import { describe, expect, it } from 'vitest';

import { actionTarget, findPersonMember, isUnregistered } from '@/lib/personActions';

const g = (groupId: string, ...lines: [string, bigint][]) => ({
  groupId,
  groupName: groupId,
  lines: lines.map(([currency, net]) => ({ currency, net })),
});

describe('actionTarget', () => {
  it('picks the group holding the most of the headline direction', () => {
    const groups = [g('a', ['INR', 76920n]), g('b', ['INR', 8218500n])];
    expect(actionTarget(groups, { currency: 'INR', net: 8295420n })).toMatchObject({
      groupId: 'b',
      amount: 8218500n,
    });
  });

  it('ignores groups running the other way or in another currency', () => {
    const groups = [g('a', ['INR', -900n]), g('b', ['USD', 500n]), g('c', ['INR', 100n])];
    expect(actionTarget(groups, { currency: 'INR', net: 100n })?.groupId).toBe('c');
  });

  it('returns a positive amount when I owe them', () => {
    const groups = [g('a', ['INR', -700n]), g('b', ['INR', -300n])];
    expect(actionTarget(groups, { currency: 'INR', net: -1000n })).toMatchObject({
      groupId: 'a',
      amount: 700n,
    });
  });

  it('is null with no headline or no matching group', () => {
    expect(actionTarget([], { currency: 'INR', net: 1n })).toBeNull();
    expect(actionTarget([g('a', ['INR', 5n])], undefined)).toBeNull();
  });
});

describe('findPersonMember', () => {
  const members = [
    { id: 'm1', profile_id: 'p1', left_at: null },
    { id: 'm2', profile_id: null, left_at: null },
    { id: 'm3', profile_id: 'p3', left_at: '2026-01-01' },
  ];
  it('matches a profile id or a guest membership id, never a former member', () => {
    expect(findPersonMember(members, 'p1')?.id).toBe('m1');
    expect(findPersonMember(members, 'm2')?.id).toBe('m2');
    expect(findPersonMember(members, 'p3')).toBeUndefined();
    expect(findPersonMember(members, 'merged')).toBeUndefined();
  });
});

describe('isUnregistered', () => {
  it('trusts the profile when there is one', () => {
    expect(isUnregistered({ is_ghost: true }, [{ is_ghost: false }])).toBe(true);
    expect(isUnregistered({ is_ghost: false }, [{ is_ghost: true }])).toBe(false);
  });
  it('falls back to the rows, and says nothing when there are none', () => {
    expect(isUnregistered(null, [{ is_ghost: true }, { is_ghost: true }])).toBe(true);
    expect(isUnregistered(null, [{ is_ghost: true }, { is_ghost: false }])).toBe(false);
    expect(isUnregistered(null, [])).toBe(false);
  });
});
