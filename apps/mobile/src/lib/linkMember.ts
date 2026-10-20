/**
 * The pure half of "Link to a Waves user" (link_placeholder_member): what the
 * member screen and its sheet decide without a component in sight, kept here
 * so a test can pin each decision without rendering anything.
 */

import { isGhost, isViewer } from '@/data/types';
import type { UiStrings } from '@/i18n';

/** Somebody the sheet can offer: a member already here, or a person outside. */
export interface LinkPerson {
  profileId: string;
  name: string;
  avatarUrl: string | null;
  /** Their member row in this group, when they are already in it (a merge). */
  memberId: string | null;
}

/**
 * What the search box holds decides which channel `waves_find_person` is
 * asked — no second control. Anything that is not an address or at least six
 * digits is a name, which is matched against the lists on the phone.
 */
export function channelFor(query: string): 'email' | 'phone' | null {
  const value = query.trim();
  if (value.includes('@')) return value.length > 2 ? 'email' : null;
  // Six digits is not a valid number anywhere; it is just the floor below which
  // a search cannot mean anything and should not spend one of the daily few.
  return value.replace(/[^0-9]/g, '').length >= 6 ? 'phone' : null;
}

/** The people whose name contains what was typed, case- and space-blind. */
export function matchPeople<T extends { name: string }>(query: string, people: readonly T[]): T[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === '') return [...people];
  return people.filter((person) => person.name.toLocaleLowerCase().includes(needle));
}

/**
 * The members of this group who could be "who Renny is": real accounts, still
 * here, not the viewer (that is "This is me") and not the placeholder itself.
 */
export function membersAsPeople(
  members: readonly {
    id: string;
    profile_id: string | null;
    left_at: string | null;
    profile?: { display_name: string; avatar_url: string | null } | null;
  }[],
  viewerId: string | null | undefined,
  placeholderId: string,
): LinkPerson[] {
  return members
    .filter(
      (member) =>
        !isGhost(member) &&
        member.left_at === null &&
        member.id !== placeholderId &&
        !isViewer(member, viewerId),
    )
    .map((member) => ({
      profileId: member.profile_id as string,
      name: member.profile?.display_name ?? '',
      avatarUrl: member.profile?.avatar_url ?? null,
      memberId: member.id,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The server's one-word reasons, in the viewer's language. */
export function linkReasonText(reason: string | undefined, t: UiStrings): string {
  switch (reason) {
    case 'GUEST':
      return t.link.guest;
    case 'THAT_IS_YOU':
      return t.link.thatIsYou;
    case 'RATE_LIMITED':
      return t.link.rateLimited;
    case 'NOT_ALLOWED':
      return t.link.notAllowed;
    case 'NOT_FOUND':
      return t.link.notFound;
    case 'NOT_A_PLACEHOLDER':
    case 'NOT_CLAIMABLE':
    case 'ALREADY_DECIDED':
      return t.link.placeTaken;
    case 'ACCOUNT_REQUIRED':
      return t.link.needsAccount;
    default:
      return t.link.failed;
  }
}
