/**
 * Who "add someone → from another group" offers, and in what order.
 *
 * The mutation this feeds (`addGhost`, the same one the contacts picker
 * drives) is real and irreversible-by-this-screen, so what is worth holding
 * still is exactly who ends up offered: real accounts never appear (there is
 * no consent-free way to add one), the viewer never appears, somebody already
 * in the target group is shown rather than hidden, and a person who left a
 * source group is not dragged back in as a stray row.
 */
import { describe, expect, it } from 'vitest';

import { offerFromOtherGroups, type SourceGroup } from '../src/lib/addFromAnotherGroup';

const VIEWER = 'viewer-1';

function group(groupId: string, groupLabel: string, members: SourceGroup['members']): SourceGroup {
  return { groupId, groupLabel, members };
}

function ghost(
  memberId: string,
  name: string,
  extra: Partial<{ email: string | null; phone: string | null; leftAt: string | null }> = {},
) {
  return {
    memberId,
    profileId: null,
    name,
    email: extra.email ?? null,
    phone: extra.phone ?? null,
    leftAt: extra.leftAt ?? null,
  };
}

function account(memberId: string, profileId: string, name: string) {
  return { memberId, profileId, name, email: null, phone: null, leftAt: null };
}

describe('offering people from another group', () => {
  it('offers nobody when the viewer belongs to no other group', () => {
    const groups = [group('trip', 'Goa', [ghost('m1', 'Priya')])];
    expect(
      offerFromOtherGroups({ currentGroupId: 'trip', viewerProfileId: VIEWER, groups }),
    ).toEqual([]);
  });

  it('sections by source group, in the order the groups arrived', () => {
    const groups = [
      group('trip', 'New trip', []),
      group('flatmates', 'Flatmates', [ghost('m1', 'Zara'), ghost('m2', 'Amit')]),
      group('goa', 'Goa 2025', [ghost('m3', 'Priya')]),
    ];
    const sections = offerFromOtherGroups({
      currentGroupId: 'trip',
      viewerProfileId: VIEWER,
      groups,
    });
    expect(sections.map((section) => section.groupId)).toEqual(['flatmates', 'goa']);
    // Within a section, alphabetical — Amit before Zara, not insertion order.
    expect(sections[0]?.people.map((person) => person.name)).toEqual(['Amit', 'Zara']);
  });

  it('never offers the viewer, whichever group they turn up in', () => {
    const groups = [
      group('trip', 'New trip', []),
      group('flatmates', 'Flatmates', [account('m1', VIEWER, 'Me'), ghost('m2', 'Amit')]),
    ];
    const sections = offerFromOtherGroups({
      currentGroupId: 'trip',
      viewerProfileId: VIEWER,
      groups,
    });
    expect(sections[0]?.people.map((person) => person.name)).toEqual(['Amit']);
  });

  it('drops real account holders — only a ghost can be copied without their consent', () => {
    const groups = [
      group('trip', 'New trip', []),
      group('flatmates', 'Flatmates', [account('m1', 'someone-else', 'Zara'), ghost('m2', 'Amit')]),
    ];
    const sections = offerFromOtherGroups({
      currentGroupId: 'trip',
      viewerProfileId: VIEWER,
      groups,
    });
    expect(sections[0]?.people.map((person) => person.name)).toEqual(['Amit']);
  });

  it('leaves out somebody who has left the source group', () => {
    const groups = [
      group('trip', 'New trip', []),
      group('flatmates', 'Flatmates', [
        ghost('m1', 'Amit', { leftAt: '2026-01-01T00:00:00Z' }),
        ghost('m2', 'Zara'),
      ]),
    ];
    const sections = offerFromOtherGroups({
      currentGroupId: 'trip',
      viewerProfileId: VIEWER,
      groups,
    });
    expect(sections[0]?.people.map((person) => person.name)).toEqual(['Zara']);
  });

  it('shows someone already in the target group rather than dropping the row', () => {
    const groups = [
      group('trip', 'New trip', [ghost('already', 'Priya', { phone: '+919876543210' })]),
      group('goa', 'Goa 2025', [
        ghost('m1', 'Priya', { phone: '9876543210' }),
        ghost('m2', 'Zara'),
      ]),
    ];
    const sections = offerFromOtherGroups({
      currentGroupId: 'trip',
      viewerProfileId: VIEWER,
      groups,
    });
    const [priya, zara] = sections[0]?.people ?? [];
    expect(priya?.name).toBe('Priya');
    expect(priya?.already).toBe(true);
    expect(zara?.already).toBe(false);
    // Both rows still come back — "already" is a flag on the row, not a
    // reason to drop it, so the count and the row are never lost.
    expect(sections[0]?.people).toHaveLength(2);
  });

  it('matches "already in the group" by name only when neither side carries an address', () => {
    const groups = [
      group('trip', 'New trip', [ghost('already', 'Priya')]),
      group('goa', 'Goa 2025', [ghost('m1', 'priya')]),
    ];
    const sections = offerFromOtherGroups({
      currentGroupId: 'trip',
      viewerProfileId: VIEWER,
      groups,
    });
    expect(sections[0]?.people[0]?.already).toBe(true);
  });

  it('does not fold two different addressed people who merely share a name', () => {
    const groups = [
      group('trip', 'New trip', [ghost('already', 'Ravi', { phone: '+911111111111' })]),
      group('goa', 'Goa 2025', [ghost('m1', 'Ravi', { phone: '+912222222222' })]),
    ];
    const sections = offerFromOtherGroups({
      currentGroupId: 'trip',
      viewerProfileId: VIEWER,
      groups,
    });
    expect(sections[0]?.people[0]?.already).toBe(false);
  });

  it('a member who left the target group no longer counts as already there', () => {
    const groups = [
      group('trip', 'New trip', [ghost('gone', 'Priya', { leftAt: '2026-01-01T00:00:00Z' })]),
      group('goa', 'Goa 2025', [ghost('m1', 'Priya')]),
    ];
    const sections = offerFromOtherGroups({
      currentGroupId: 'trip',
      viewerProfileId: VIEWER,
      groups,
    });
    expect(sections[0]?.people[0]?.already).toBe(false);
  });

  it('drops a source group entirely once nobody in it is left to offer', () => {
    const groups = [
      group('trip', 'New trip', []),
      group('solo', 'Just the viewer', [account('m1', VIEWER, 'Me')]),
    ];
    expect(
      offerFromOtherGroups({ currentGroupId: 'trip', viewerProfileId: VIEWER, groups }),
    ).toEqual([]);
  });

  it('keeps two memberships of the same person, one per other group, as separate rows', () => {
    const groups = [
      group('trip', 'New trip', []),
      group('flatmates', 'Flatmates', [ghost('m1', 'Priya', { phone: '+919876543210' })]),
      group('goa', 'Goa 2025', [ghost('m2', 'Priya', { phone: '+919876543210' })]),
    ];
    const sections = offerFromOtherGroups({
      currentGroupId: 'trip',
      viewerProfileId: VIEWER,
      groups,
    });
    expect(sections).toHaveLength(2);
    expect(sections.map((section) => section.people[0]?.key)).toEqual(['flatmates:m1', 'goa:m2']);
  });
});
