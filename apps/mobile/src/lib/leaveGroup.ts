/** Nobody else is in the group: leaving does not hand it on, it empties it. */
export function isLastMember(members: readonly { left_at?: string | null }[]): boolean {
  return members.filter((member) => !member.left_at).length <= 1;
}
