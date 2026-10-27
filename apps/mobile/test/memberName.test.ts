/**
 * What the past calls a member who is no longer in the group.
 *
 * The bug: an expense still points at a member id after an admin removes them or
 * they leave, but the roster the screen resolved names against was filtered to
 * active members, so every departed person read "Someone". These pin the
 * resolver: a departed ghost and a departed account keep their names with a
 * "(left)" mark, and only an id with no row at all is "Someone".
 */

import { describe, expect, it } from 'vitest';

import type { MemberRow } from '../src/data/types';
import { memberNameById } from '../src/lib/memberName';

const member = (over: Partial<MemberRow>): MemberRow =>
  ({
    id: 'm',
    group_id: 'g',
    profile_id: null,
    ghost_name: null,
    role: 'member',
    vpa: null,
    left_at: null,
    profile: null,
    ...over,
  }) as MemberRow;

const LEFT = '(left)';
const options = { viewerId: 'me', someone: 'Someone', leftLabel: LEFT };

const roster = new Map(
  [
    member({ id: 'active', ghost_name: 'Asha' }),
    member({ id: 'ghost-left', ghost_name: 'Renny Hethu', left_at: '2026-10-01T00:00:00Z' }),
    member({
      id: 'account-left',
      profile_id: 'p-guest',
      profile: {
        id: 'p-guest',
        display_name: 'Guest',
        avatar_url: null,
        default_vpa: null,
      },
      left_at: '2026-10-02T00:00:00Z',
    }),
    member({ id: 'me-left', profile_id: 'me', ghost_name: null, left_at: '2026-10-03T00:00:00Z' }),
  ].map((row) => [row.id, row] as const),
);

describe('memberNameById', () => {
  it('exports the viewer by profile name while keeping You in the UI', () => {
    const lookup = new Map([
      [
        'self',
        member({
          profile_id: 'me',
          profile: { display_name: 'Madan' } as MemberRow['profile'],
        }),
      ],
    ]);
    expect(memberNameById(lookup, 'self', options)).toBe('You');
    expect(memberNameById(lookup, 'self', { ...options, forExport: true })).toBe('Madan');
  });
  it('names an active member plainly', () => {
    expect(memberNameById(roster, 'active', options)).toBe('Asha');
  });

  it('keeps the name of a ghost who left, marked as left', () => {
    expect(memberNameById(roster, 'ghost-left', options)).toBe('Renny Hethu (left)');
  });

  it('keeps the display name of an account that left, marked as left', () => {
    expect(memberNameById(roster, 'account-left', options)).toBe('Guest (left)');
  });

  it('leaves the mark off for an avatar, which takes the bare name', () => {
    expect(memberNameById(roster, 'ghost-left', { ...options, bare: true })).toBe('Renny Hethu');
  });

  it('keeps "You" and a block mask untagged', () => {
    expect(memberNameById(roster, 'me-left', options)).toBe('You');
    expect(
      memberNameById(roster, 'account-left', { ...options, blocked: new Set(['p-guest']) }),
    ).toBe('Someone');
  });

  it('says Someone only for an id that resolves to no row', () => {
    expect(memberNameById(roster, 'nobody', options)).toBe('Someone');
    expect(memberNameById(roster, null, options)).toBe('Someone');
  });
});
