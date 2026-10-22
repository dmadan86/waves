/**
 * Who a duplicated group starts with.
 *
 * The clone seeds the New Group screen from the source's members. The bug this
 * pins: a member on Waves came across as a name only (their row carries no
 * address when they joined by link), so the copy made a "Not on Waves yet"
 * placeholder of a person who is on Waves. They must be carried by profile id
 * so they are added as themselves; a placeholder keeps its address; whoever
 * left, and the person making the copy, are not carried at all.
 */
import { describe, expect, it } from 'vitest';

import { type MemberRow } from '@/data/types';
import { membersToClone } from '@/lib/cloneMembers';

const ME = 'profile-me';
const MATT = 'profile-matt';

const row = (over: Partial<MemberRow> & { id: string }): MemberRow => ({
  group_id: 'g-1',
  profile_id: null,
  ghost_name: null,
  role: 'member',
  vpa: null,
  left_at: null,
  ...over,
});

const members: MemberRow[] = [
  row({ id: 'm-me', profile_id: ME, role: 'admin' }),
  row({
    id: 'm-matt',
    profile_id: MATT,
    profile: { id: MATT, display_name: 'Matt', avatar_url: null, default_vpa: null },
  }),
  row({ id: 'm-renny', ghost_name: 'Renny', invite_email: 'renny@example.com' }),
  row({ id: 'm-left', ghost_name: 'Gone', left_at: '2026-10-01T00:00:00Z' }),
];

describe('membersToClone', () => {
  it('carries a Waves member by their account, a placeholder by its address, nobody who left', () => {
    expect(membersToClone(members, ME)).toEqual([
      { name: 'Matt', email: null, phone: null, profileId: MATT },
      { name: 'Renny', email: 'renny@example.com', phone: null, profileId: null },
    ]);
  });

  it('leaves out the person making the copy', () => {
    expect(membersToClone(members, ME).some((person) => person.profileId === ME)).toBe(false);
  });
});
