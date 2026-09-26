/**
 * Which of your groups is "you and this person" — the home of an individual
 * expense.
 *
 * Waves has no friend list and no groupless expense. An expense with one person
 * lives in a group with exactly the two of you in it, and the People tab shows
 * that group as the person. Nothing on the server marks such a group; the app
 * recognises one by its live membership, and so does this. Kept pure, like
 * `expense.ts`, so the rule can be tested without a database.
 *
 * The API has the same rule in `apps/api/src/server/pair.ts`. This server
 * deliberately depends on nothing in the workspace, so the two are twins kept
 * honest by their tests rather than one import.
 */

import { createHash } from 'node:crypto';

export interface PairMember {
  readonly memberId: string;
  readonly profileId: string | null;
  readonly name: string;
}

export interface PairGroup {
  readonly groupId: string;
  readonly groupName: string | null;
  readonly currency: string;
  /** The group's live members — nobody who has left. */
  readonly members: readonly PairMember[];
}

export type PairLookup =
  | {
      readonly kind: 'found';
      readonly group: PairGroup;
      readonly me: PairMember;
      readonly them: PairMember;
    }
  | { readonly kind: 'none' }
  | {
      readonly kind: 'ambiguous';
      readonly candidates: readonly { groupId: string; name: string; groupName: string | null }[];
    };

/**
 * A name as people compare names: trimmed, spaces collapsed, accents folded and
 * case ignored, so "Renée" and "renee" are one person. The same folding the app
 * uses to match people to groups (`peopleSignatureKey`).
 */
export function foldName(name: string): string {
  return name.normalize('NFKD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The ids a new one-to-one with this person is made under, the same on every
 * call.
 *
 * Making a pair takes two writes — the group, then them as a ghost — and an
 * agent may retry, or send "coffee with Priya" and "cake with Priya" at once.
 * With fresh random ids, a retry after the first write made a second group
 * and parallel calls made one each; with these, every attempt lands on the
 * same group and the same ghost, and the RPCs hand back what is already there.
 *
 * `generation` moves on when the ids are spoken for by a group that can no
 * longer be used — deleted, left, or grown past two people.
 */
export function pairIds(
  meProfileId: string,
  person: string,
  generation: number,
): { groupId: string; myMemberId: string; theirMemberId: string } {
  const id = (role: string): string => {
    const hex = createHash('sha256')
      .update(`waves-pair\0${meProfileId}\0${foldName(person)}\0${generation}\0${role}`)
      .digest('hex');
    // Shaped as a version-5-style UUID so it passes as one everywhere.
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      `5${hex.slice(13, 16)}`,
      `${((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
      hex.slice(20, 32),
    ].join('-');
  };
  return { groupId: id('group'), myMemberId: id('me'), theirMemberId: id('them') };
}

/**
 * Your one-to-one group with the person named, if there is exactly one.
 *
 * A pair is a group with two live members, one of them you. The other is
 * matched by their whole name first, then — for a single word — by first name,
 * so "Renny" finds Renny Benita. More than one pair answering to the name is
 * returned as ambiguous rather than picked from: the Friends screen makes a new
 * group every time somebody is added, so two "Rennys" can be two people, and
 * choosing puts a real debt on one of them.
 */
export function findPair(
  groups: readonly PairGroup[],
  meProfileId: string,
  said: string,
): PairLookup {
  const pairs = groups.flatMap((group) => {
    if (group.members.length !== 2) return [];
    const me = group.members.find((m) => m.profileId === meProfileId);
    const them = group.members.find((m) => m !== me);
    return me && them ? [{ group, me, them }] : [];
  });

  const wanted = foldName(said);
  let matches = pairs.filter((p) => foldName(p.them.name) === wanted);
  if (matches.length === 0 && !wanted.includes(' ')) {
    matches = pairs.filter((p) => foldName(p.them.name).split(' ')[0] === wanted);
  }

  if (matches.length === 0) return { kind: 'none' };
  if (matches.length === 1) return { kind: 'found', ...matches[0]! };
  return {
    kind: 'ambiguous',
    candidates: matches.map((p) => ({
      groupId: p.group.groupId,
      name: p.them.name,
      groupName: p.group.groupName,
    })),
  };
}
