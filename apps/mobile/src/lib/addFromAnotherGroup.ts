/**
 * Who to offer when adding somebody "from another group" — the same five
 * friends, a new trip.
 *
 * The commonest reason a group's "add someone" section gets opened at all is
 * not a stranger to invite, it is a roster you already typed in somewhere
 * else: the flatmates who were also on last month's Goa trip, the same three
 * people you split every dinner with. Nothing in the app answered that before
 * this — `addSomeoneRoutes.ts` names the gap explicitly rather than drawing a
 * row that led nowhere. This is the flow that fills it.
 *
 * ## Where the roster comes from
 *
 * `useKnownContacts().membersByGroup` (the picker's own "who Waves already
 * has" index) already holds every group's members off the local mirror, with
 * the viewer's own row filtered out at the source — there is nothing here to
 * add for that; it is simply never in the input. This module's job is the
 * rest: which of those memberships are worth offering, and in what shape.
 *
 * ## Grouped by source group, not folded into one directory
 *
 * `buildKnownIndex` (`lib/contactMatch`) already folds a person's memberships
 * across every group into one row — useful for "highlight who you already
 * know" while typing, wrong for *picking* somebody to copy. Folding by name
 * is explicitly the weaker rule there ("two flatmates called Ravi are two
 * debts"), fine for a highlight, not for the membership a real mutation is
 * about to create. So the unit offered here stays a specific membership in a
 * specific other group — precise, and it matches how the person actually
 * thinks about the case this flow exists for ("the Goa people", not "everyone
 * I have ever typed a name for"). Sections come out in the order the caller's
 * groups arrived in (Settings sorts however it likes — favourites first,
 * same as `clone-group` — this module does not re-decide that); people inside
 * a section are ordered by name.
 *
 * ## Only ghosts are offered
 *
 * A member with a real account (`profileId` set) is not offered here, on
 * purpose — the same reasoning `mergePeople.ts`'s `isMergeable` states for why
 * a real person cannot be merged: "already one identity across every group by
 * their profile id, so folding them under a made-up name would be a lie, not
 * a [copy]." There is no RPC that attaches somebody else's account to a group
 * without their consent, and `waves_add_ghost_member` — the one mutation this
 * flow is allowed to use — can only ever create a ghost. Offering an
 * account-holder here would mean one of two wrong things happening silently:
 * a duplicate ghost wearing their name, or an add that looks like it worked
 * and did not touch their account at all. Neither is acceptable, so real
 * members are dropped before the offer is built; the existing join-link row
 * is still how somebody who already has an account gets in here — by their
 * own consent, joining as themselves.
 *
 * ## Identity of a copied person, and the duplicate this must not create
 *
 * A ghost picked here is added to the target group exactly the way the
 * contacts picker already adds one: a *new* membership carrying the same
 * name and contact hint (`invite_email`/`invite_phone`) as the source
 * membership, through the same `addGhost` mutation. It is not linked to the
 * source membership in any way that survives past that — cross-group ghost
 * identity in this app is never automatic (see `mergePeople.ts`'s header: a
 * ghost is one membership until a viewer explicitly says two are the same
 * person). That is a deliberate choice, not a gap this flow should patch:
 * inventing a second, silent notion of "same ghost across groups" here would
 * disagree with the one the Friends merge screen already owns, and two rules
 * for the same question is how they drift apart. If the copied person and
 * their original carry the same address, the ordinary `suggestMergeCluster`
 * heuristic will offer to fold them on the Friends screen later — the same
 * path that already exists for anyone added twice, including from contacts.
 *
 * ## Already in the target group
 *
 * Shown, not hidden — `already: true` rather than a dropped row — so the
 * question "wait, is Priya already on this trip?" is answered by the list
 * itself instead of by her silent absence. It mirrors `ContactRow`'s own
 * `already` treatment in `components/ContactPicker.tsx` exactly, for the
 * sibling flow this one sits beside. A membership counts as already-here by
 * the same rule `buildKnownIndex` folds by: the same address if either side
 * has one, the same folded name only when neither does (`sameAddress`/`fold`
 * from `lib/contactMatch`) — matched against the target group's own *active*
 * members (a member who left is not "already here"; re-adding them from
 * another group is exactly the point).
 */

import { fold, sameAddress } from '@/lib/contactMatch';

/** One person's row in the source group, as much as this module reads. */
export interface SourceMember {
  /** The `group_members` row id in the *source* group — what makes two
   *  memberships of the same name in two different groups two different rows
   *  rather than one. */
  readonly memberId: string;
  /** Set for a real account; null for a ghost. Only ghosts are offered. */
  readonly profileId: string | null;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  /** Set once they have left that group. Left members are read for neither
   *  side of this: they are not offered as a source, and they do not count
   *  toward "already in the target group". */
  readonly leftAt: string | null;
}

/** One group's membership, as this module needs it. */
export interface SourceGroup {
  readonly groupId: string;
  /** However the caller labels it — `groupLabel()` for an unnamed group. */
  readonly groupLabel: string;
  readonly members: readonly SourceMember[];
}

export interface AddFromAnotherGroupInput {
  /** The group the picked people would be added to. */
  readonly currentGroupId: string;
  /** Whoever is signed in — never offered, whichever group they turn up in. */
  readonly viewerProfileId: string | null;
  /** Every group the viewer belongs to, the current one included — this
   *  module does the excluding, so the caller can simply pass `useGroups()`
   *  straight through. */
  readonly groups: readonly SourceGroup[];
}

/** One offerable row: a specific membership in a specific other group. */
export interface OfferedPerson {
  /** `${groupId}:${memberId}` — stable across a re-render, unique per row
   *  even when the same person turns up under two different groups. */
  readonly key: string;
  readonly groupId: string;
  readonly groupLabel: string;
  readonly memberId: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  /** Already a member of the target group — greyed, not droppable, and never
   *  selectable (see the module header). */
  readonly already: boolean;
}

/** One other group's section of the offer. */
export interface OfferedGroup {
  readonly groupId: string;
  readonly groupLabel: string;
  readonly people: readonly OfferedPerson[];
}

/** Two source rows read as the same target-group member: the rule
 *  `buildKnownIndex` folds by, kept in step with it on purpose (see the
 *  module header) rather than redeclared with its own drift. */
function sameHuman(
  a: { readonly name: string; readonly email: string | null; readonly phone: string | null },
  b: { readonly name: string; readonly email: string | null; readonly phone: string | null },
): boolean {
  const addressed = Boolean(a.email || a.phone) && Boolean(b.email || b.phone);
  if (addressed) return sameAddress(a, b);
  if (a.email || a.phone || b.email || b.phone) return false;
  return fold(a.name.trim()) === fold(b.name.trim());
}

/**
 * The other groups' people, sectioned and ready for the picker — the current
 * group and anyone already in it excluded from what can be *picked*, but not
 * from what is *shown* (see the module header on both).
 */
export function offerFromOtherGroups(input: AddFromAnotherGroupInput): readonly OfferedGroup[] {
  const current = input.groups.find((group) => group.groupId === input.currentGroupId);
  const currentRoster = (current?.members ?? []).filter(
    (member) => member.leftAt === null && member.profileId !== input.viewerProfileId,
  );

  const sections: OfferedGroup[] = [];
  for (const group of input.groups) {
    if (group.groupId === input.currentGroupId) continue;

    const people: OfferedPerson[] = group.members
      .filter((member) => member.leftAt === null)
      .filter((member) => member.profileId !== input.viewerProfileId)
      // Only ghosts: a real account is one identity by its profile id and is
      // never offered here (see the module header).
      .filter((member) => member.profileId === null)
      .map((member) => ({
        key: `${group.groupId}:${member.memberId}`,
        groupId: group.groupId,
        groupLabel: group.groupLabel,
        memberId: member.memberId,
        name: member.name,
        email: member.email,
        phone: member.phone,
        already: currentRoster.some((existing) => sameHuman(existing, member)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (people.length > 0) {
      sections.push({ groupId: group.groupId, groupLabel: group.groupLabel, people });
    }
  }
  return sections;
}
