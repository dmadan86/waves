/**
 * Who may be merged, and what a merge is called.
 *
 * A guest exists once per group: a name is no proof that the "Alex" in one
 * group is the "Alex" in another, so Waves never assumes it. This is the pure
 * half of the screen where somebody says they *are* the same — who is eligible,
 * how the picked rows resolve to member ids, and which name to offer.
 *
 * Only guests. A real person is already one identity across every group by
 * their account, so folding them under a made-up name would be a lie rather
 * than a merge; the RPC refuses it too, and this keeps them off the list so
 * nobody is offered a choice the server will reject.
 *
 * The phone has a richer version of this in `apps/mobile/src/data/mergePeople.ts`:
 * it matches device contacts and guards against guests that exist only in the
 * offline queue. Neither applies in a browser — there is no address book and no
 * queue — and the inputs differ too (server reads here, mirror + queue there),
 * so this is the web's own smaller set rather than a shared module. Worth
 * consolidating in `@waves/core` if a third caller ever appears.
 */

/** A guest, as this screen needs them: identity, reach, and what is known. */
export interface Guest {
  /** Every membership row this guest holds — one per group. */
  memberIds: string[];
  /** The merged identity when they are already merged; their own id otherwise. */
  key: string;
  name: string;
  groupCount: number;
  /** Given a number or an address when they were invited: likelier to be the
   *  one being merged *into*, so their name is the one worth suggesting. */
  hasContact: boolean;
}

/** A membership row, narrowed to what merging cares about. */
export interface MemberLike {
  id: string;
  group_id: string;
  profile_id: string | null;
  ghost_name: string | null;
  left_at: string | null;
  invite_email?: string | null;
  invite_phone?: string | null;
}

/** One guest folded under a merged person, as the table stores it. */
export interface MergeLike {
  member_id: string;
  person_id: string;
  display_name: string;
}

/**
 * Every guest the viewer shares a group with, already-merged ones folded.
 *
 * Built from membership rather than balances: a guest is mergeable whether or
 * not they currently owe anything, and the balance list drops everybody who is
 * square. The one a person is most likely merging into — the one they gave a
 * phone number to — is exactly the one a balance list would hide.
 */
export function guestsFrom(
  members: readonly MemberLike[],
  merges: readonly MergeLike[],
  fallbackName: string,
): Guest[] {
  const mergedBy = new Map(merges.map((row) => [row.member_id, row]));
  const byKey = new Map<string, Guest>();

  for (const member of members) {
    // A real person, or somebody who has left: neither is a guest to merge.
    if (member.profile_id !== null || member.left_at !== null) continue;

    const merge = mergedBy.get(member.id);
    const key = merge?.person_id ?? member.id;
    const name = merge?.display_name ?? member.ghost_name?.trim() ?? '';
    const hasContact = Boolean(member.invite_email?.trim() || member.invite_phone?.trim());

    const existing = byKey.get(key);
    if (existing) {
      existing.memberIds.push(member.id);
      existing.groupCount += 1;
      // A merged person keeps the merge's name; an unmerged guest keeps the
      // first name that is not empty.
      if (!existing.name) existing.name = name;
      existing.hasContact ||= hasContact;
      continue;
    }

    byKey.set(key, {
      memberIds: [member.id],
      key,
      name: name || fallbackName,
      groupCount: 1,
      hasContact,
    });
  }

  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The member ids a selection resolves to.
 *
 * A merged person stands for several membership rows, and all of them travel:
 * merging "Alex (2 groups)" with another guest must not leave one of Alex's two
 * memberships behind under the old identity.
 */
export function memberIdsFor(picked: readonly Guest[]): string[] {
  return [...new Set(picked.flatMap((guest) => guest.memberIds))];
}

/**
 * The name to offer for the merged person.
 *
 * The one with contact details wins: if you gave somebody a phone number when
 * you invited them, that is the name you know them by. Otherwise the first
 * named pick, so the field is rarely empty. Only ever a suggestion — the field
 * stays editable, because the server takes whatever is typed.
 */
export function suggestedName(picked: readonly Guest[]): string {
  const identified = picked.find((guest) => guest.hasContact && guest.name.trim());
  return (identified ?? picked.find((guest) => guest.name.trim()))?.name.trim() ?? '';
}

/** Two distinct people, and a name. Anything less the server refuses anyway. */
export function canMerge(picked: readonly Guest[], name: string): boolean {
  return picked.length >= 2 && name.trim().length > 0;
}

export interface MergeWords {
  errorTooFew: string;
  errorNotMergeable: string;
  errorNameRequired: string;
  errorNotSignedIn: string;
  errorGeneric: string;
}

/**
 * The server's refusal, as a sentence.
 *
 * Each code sends somebody to do a different thing — pick another person, type
 * a name, sign in again — so one "could not merge" for all of them would be a
 * worse answer than the server gave. The raw message never reaches the page:
 * it names tables.
 */
export function mergeRefusal(caught: unknown, words: MergeWords): string {
  const raw = caught instanceof Error ? caught.message : String(caught ?? '');
  if (raw.includes('TOO_FEW')) return words.errorTooFew;
  if (raw.includes('NOT_MERGEABLE')) return words.errorNotMergeable;
  if (raw.includes('NAME_REQUIRED')) return words.errorNameRequired;
  if (raw.includes('NOT_SIGNED_IN')) return words.errorNotSignedIn;
  return words.errorGeneric;
}
