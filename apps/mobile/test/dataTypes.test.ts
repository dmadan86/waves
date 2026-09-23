/**
 * The small naming questions in data/types that every screen asks: what to call
 * a nameless group, who a feed row's actor is, and where a member is paid.
 */

import { describe, expect, it } from 'vitest';

import { RailId } from '@waves/core';

import { actorName, groupLabel, payableAt, type MemberRow } from '@/data/types';

function member(id: string, over: Partial<MemberRow> = {}): MemberRow {
  return {
    id: id as MemberRow['id'],
    group_id: 'g',
    profile_id: null,
    ghost_name: id,
    role: 'member',
    vpa: null,
    left_at: null,
    ...over,
  };
}

const ME = member('me', {
  profile_id: 'p-me',
  ghost_name: null,
  profile: {
    id: 'p-me',
    display_name: 'Asha',
    avatar_url: null,
    default_vpa: null,
  },
});

describe('groupLabel', () => {
  it('uses the name when there is one, trimmed', () => {
    expect(groupLabel({ name: '  Goa  ' }, [ME, member('Ravi')], 'p-me')).toBe('Goa');
  });

  it('labels a nameless group by who else is in it', () => {
    // Given no name, when there are one, two or more others, then the people are the label
    expect(groupLabel({ name: null }, [ME], 'p-me')).toBe('New group');
    expect(groupLabel({ name: ' ' }, [ME, member('Ravi')], 'p-me')).toBe('You and Ravi');
    expect(groupLabel(null, [ME, member('Ravi'), member('Priya')], 'p-me')).toBe(
      'You, Ravi and Priya',
    );
    expect(
      groupLabel(undefined, [ME, member('Ravi'), member('Priya'), member('Sam')], 'p-me'),
    ).toBe('You, Ravi and 2 others');
  });

  it('leaves out people who have left', () => {
    const left = member('Old', { left_at: '2026-01-01T00:00:00Z' });
    expect(groupLabel({ name: null }, [ME, left, member('Ravi')], 'p-me')).toBe('You and Ravi');
  });

  it('defaults to "New group" with no members at all', () => {
    expect(groupLabel({ name: null })).toBe('New group');
  });
});

describe('actorName', () => {
  const RAVI = {
    id: 'm',
    profile_id: 'p-ravi',
    ghost_name: null,
    profile: { display_name: 'Ravi' },
  };

  it('hides a blocked person behind the someone label', () => {
    expect(actorName(RAVI, 'p-me', new Set(['p-ravi']), 'Somebody')).toBe('Somebody');
  });

  it('never hides yourself, even if your own id is in the blocked set', () => {
    expect(actorName({ ...RAVI, profile_id: 'p-me' }, 'p-me', new Set(['p-me']))).toBe('You');
  });

  it('falls back to the ghost name, then to someone', () => {
    expect(actorName({ ...RAVI, profile: null, ghost_name: 'Chic' }, null)).toBe('Chic');
    expect(actorName({ ...RAVI, profile: null, ghost_name: null }, null)).toBe('Someone');
    expect(actorName(null, null, null, 'Anon')).toBe('Anon');
  });
});

describe('payableAt', () => {
  it('prefers the group’s own rail pair, then the legacy vpa, then the profile', () => {
    expect(
      payableAt(member('a', { payment_rail: 'pix', payment_handle: 'key', vpa: 'a@upi' })),
    ).toEqual({ rail: 'pix', handle: 'key' });
    expect(payableAt(member('a', { vpa: 'a@upi' }))).toEqual({ rail: RailId.Upi, handle: 'a@upi' });
    expect(
      payableAt(
        member('a', {
          profile: { id: 'p', display_name: 'A', avatar_url: null, default_vpa: 'p@upi' },
        }),
      ),
    ).toEqual({ rail: RailId.Upi, handle: 'p@upi' });
  });

  it('is null for somebody who has given no details', () => {
    expect(payableAt(member('a'))).toBeNull();
  });
});
