/** A co-member's email address is theirs; only the person themself sees it on the person page. */
export function withoutCoMemberEmail<T extends { is_you: boolean; email: string | null }>(
  row: T,
): T {
  return row.is_you ? row : { ...row, email: null };
}
