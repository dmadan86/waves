/**
 * Who may be merged, and what the merge is called.
 *
 * Merging is irreversible and it is the one place in the app where a person's
 * identity is decided by assertion rather than by an account. The rules are
 * worth pinning: a real person must never be offered, a merged person must
 * carry every membership they stand for, and the suggested name must come from
 * the guest somebody actually knows.
 */

import { describe, expect, it } from 'vitest';

import {
  canMerge,
  guestsFrom,
  memberIdsFor,
  mergeRefusal,
  suggestedName,
  type MemberLike,
  type MergeLike,
} from '@/lib/mergePeople';

function member(over: Partial<MemberLike> & { id: string; group_id: string }): MemberLike {
  return {
    profile_id: null,
    ghost_name: 'Alex',
    left_at: null,
    invite_email: null,
    invite_phone: null,
    ...over,
  };
}

describe('guestsFrom', () => {
  it('offers a guest once per group they are in', () => {
    const guests = guestsFrom(
      [
        member({ id: 'm1', group_id: 'g1', ghost_name: 'Alex' }),
        member({ id: 'm2', group_id: 'g2', ghost_name: 'Alex' }),
      ],
      [],
      'Someone',
    );
    // Two rows, because nothing yet says they are the same person. That is the
    // whole reason this screen exists.
    expect(guests).toHaveLength(2);
    expect(guests.map((guest) => guest.groupCount)).toEqual([1, 1]);
  });

  it('never offers a real person', () => {
    const guests = guestsFrom(
      [
        member({ id: 'm1', group_id: 'g1', profile_id: 'p1', ghost_name: null }),
        member({ id: 'm2', group_id: 'g1', ghost_name: 'Alex' }),
      ],
      [],
      'Someone',
    );
    expect(guests.map((guest) => guest.memberIds)).toEqual([['m2']]);
  });

  it('never offers somebody who has left', () => {
    const guests = guestsFrom(
      [member({ id: 'm1', group_id: 'g1', left_at: '2026-09-01T00:00:00Z' })],
      [],
      'Someone',
    );
    expect(guests).toEqual([]);
  });

  it('folds an existing merge into one person carrying both memberships', () => {
    const merges: MergeLike[] = [
      { member_id: 'm1', person_id: 'person-1', display_name: 'Alex Kumar' },
      { member_id: 'm2', person_id: 'person-1', display_name: 'Alex Kumar' },
    ];
    const guests = guestsFrom(
      [
        member({ id: 'm1', group_id: 'g1', ghost_name: 'Alex' }),
        member({ id: 'm2', group_id: 'g2', ghost_name: 'A. Kumar' }),
        member({ id: 'm3', group_id: 'g3', ghost_name: 'Priya' }),
      ],
      merges,
      'Someone',
    );
    const alex = guests.find((guest) => guest.key === 'person-1');
    expect(alex?.memberIds.sort()).toEqual(['m1', 'm2']);
    expect(alex?.groupCount).toBe(2);
    // The merge's own name wins over either guest's, because it is the name
    // this viewer chose for them.
    expect(alex?.name).toBe('Alex Kumar');
    expect(guests).toHaveLength(2);
  });

  it('names a guest who has none', () => {
    const guests = guestsFrom(
      [member({ id: 'm1', group_id: 'g1', ghost_name: null })],
      [],
      'Someone',
    );
    expect(guests[0]?.name).toBe('Someone');
  });

  it('marks a guest who was invited by phone or email', () => {
    const guests = guestsFrom(
      [
        member({ id: 'm1', group_id: 'g1', ghost_name: 'Alex', invite_phone: '+919884012345' }),
        member({ id: 'm2', group_id: 'g2', ghost_name: 'Priya', invite_email: '   ' }),
      ],
      [],
      'Someone',
    );
    expect(guests.find((guest) => guest.name === 'Alex')?.hasContact).toBe(true);
    // Whitespace is not a contact detail.
    expect(guests.find((guest) => guest.name === 'Priya')?.hasContact).toBe(false);
  });
});

describe('memberIdsFor', () => {
  it('carries every membership a merged person stands for', () => {
    const picked = [
      { memberIds: ['m1', 'm2'], key: 'person-1', name: 'Alex', groupCount: 2, hasContact: true },
      { memberIds: ['m3'], key: 'm3', name: 'A. Kumar', groupCount: 1, hasContact: false },
    ];
    // Leaving m2 behind would strand one of Alex's memberships under the old
    // identity — a merge that half happened.
    expect(memberIdsFor(picked).sort()).toEqual(['m1', 'm2', 'm3']);
  });

  it('sends each membership once', () => {
    const picked = [
      { memberIds: ['m1'], key: 'm1', name: 'Alex', groupCount: 1, hasContact: false },
      { memberIds: ['m1', 'm2'], key: 'p', name: 'Alex', groupCount: 2, hasContact: false },
    ];
    expect(memberIdsFor(picked).sort()).toEqual(['m1', 'm2']);
  });
});

describe('suggestedName', () => {
  const withContact = {
    memberIds: ['m1'],
    key: 'm1',
    name: 'Alex Kumar',
    groupCount: 1,
    hasContact: true,
  };
  const without = { memberIds: ['m2'], key: 'm2', name: 'Alex', groupCount: 1, hasContact: false };

  it('prefers the guest whose contact details you have', () => {
    expect(suggestedName([without, withContact])).toBe('Alex Kumar');
  });

  it('falls back to the first named pick', () => {
    expect(suggestedName([without])).toBe('Alex');
  });

  it('is empty when nobody is named', () => {
    expect(suggestedName([])).toBe('');
  });
});

describe('canMerge', () => {
  const guest = (id: string) => ({
    memberIds: [id],
    key: id,
    name: 'Alex',
    groupCount: 1,
    hasContact: false,
  });

  it('wants two people and a name', () => {
    expect(canMerge([guest('m1'), guest('m2')], 'Alex')).toBe(true);
    expect(canMerge([guest('m1')], 'Alex')).toBe(false);
    expect(canMerge([guest('m1'), guest('m2')], '   ')).toBe(false);
  });
});

describe('mergeRefusal', () => {
  const words = {
    errorTooFew: 'too few',
    errorNotMergeable: 'not mergeable',
    errorNameRequired: 'name required',
    errorNotSignedIn: 'signed out',
    errorGeneric: 'generic',
  };

  it('gives each refusal its own sentence', () => {
    expect(mergeRefusal(new Error('TOO_FEW: pick at least two'), words)).toBe('too few');
    expect(mergeRefusal(new Error('NOT_MERGEABLE: every person…'), words)).toBe('not mergeable');
    expect(mergeRefusal(new Error('NAME_REQUIRED: …'), words)).toBe('name required');
    expect(mergeRefusal(new Error('NOT_SIGNED_IN'), words)).toBe('signed out');
  });

  it('falls back rather than showing a message that names tables', () => {
    expect(mergeRefusal(new Error('permission denied for table ghost_merges'), words)).toBe(
      'generic',
    );
    expect(mergeRefusal(null, words)).toBe('generic');
  });
});
