/**
 * Tap targets on the expense detail's member rows.
 *
 * Both "Paid by" and "Who owes what" rows name a person on this bill. If that
 * member row still exists in the local group mirror, the row should open the
 * same member page as the group member list. If it no longer exists, leave it
 * inert instead of sending someone to a known "member not found" dead-end.
 */
export function expenseMemberHref(
  groupId: string,
  memberId: string,
  memberExists: boolean,
): string | null {
  return memberExists ? `/group/${groupId}/member/${memberId}` : null;
}
