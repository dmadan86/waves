import { type PickedContact } from '@/components/ContactPicker';
import { displayName, isViewer, type MemberRow } from '@/data/types';

/** One person carried from a source group onto its copy: a placeholder with
 *  whatever address it had, or an account holder named by their profile id. */
export interface ClonedPerson extends PickedContact {
  readonly profileId: string | null;
}

/**
 * The source group's people, as the copy re-adds them: everyone still in it
 * but the person making the copy (they are the new group's creator). A member
 * on Waves is named by their account, so they land in the copy as themselves
 * rather than as a "Not on Waves yet" placeholder wearing their name; a
 * placeholder keeps its name and address, which is what lets them claim later.
 */
export function membersToClone(
  members: readonly MemberRow[],
  viewerId: string | null,
): ClonedPerson[] {
  return members
    .filter((member) => !member.left_at && !isViewer(member, viewerId))
    .map((member) => ({
      name: displayName(member, viewerId),
      email: member.invite_email ?? null,
      phone: member.invite_phone ?? null,
      profileId: member.profile_id,
    }));
}
