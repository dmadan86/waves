/**
 * Tap targets on the expense detail's member rows.
 *
 * Both "Paid by" and "Who owes what" rows name a person on this bill. If that
 * member row still exists in the local group mirror, the row should open the
 * same member page as the group member list. If it no longer exists, leave it
 * inert instead of sending someone to a known "member not found" dead-end.
 */
/**
 * Kept as a template-literal type rather than a plain `string`: expo-router's
 * typed routes accept an inline `` `/group/${id}/member/${id}` `` because it
 * matches one of the generated route patterns, and a widened `string` does not.
 * The guarded router in `lib/navigation` keeps that signature, so returning
 * `string` here fails to typecheck at every call site.
 */
export type ExpenseMemberHref = `/group/${string}/member/${string}`;

export function expenseMemberHref(
  groupId: string,
  memberId: string,
  memberExists: boolean,
): ExpenseMemberHref | null {
  return memberExists ? `/group/${groupId}/member/${memberId}` : null;
}
