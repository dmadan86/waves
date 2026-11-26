import { nameOf, type Member } from '@waves/api-client';

/** Your own row says "You", whatever the profile carries (often the server's "Guest"). */
export function memberLabel(member: Member, myProfileId: string | null, you: string): string {
  return myProfileId && member.profile_id === myProfileId ? you : nameOf(member);
}
