import type { ActivityRow, ExpenseComment, Member } from '@waves/api-client';

/** Comments are not in `activity_log`, so they are shaped as rows to join the feed. */
export function commentRows(
  comments: readonly ExpenseComment[],
  members: readonly Member[],
  expenseNames: ReadonlyMap<string, string>,
): ActivityRow[] {
  return comments.map((comment) => {
    const author = members.find((member) => member.id === comment.author_member_id);
    return {
      id: `comment-${comment.id}`,
      group_id: comment.group_id,
      actor_member_id: comment.author_member_id,
      actor: author
        ? {
            id: author.id,
            profile_id: author.profile_id,
            ghost_name: author.ghost_name,
            profile: author.profile ? { display_name: author.profile.display_name } : null,
          }
        : null,
      verb: 'commented',
      object_type: 'expense',
      object_id: comment.expense_id,
      payload: { description: expenseNames.get(comment.expense_id) ?? null },
      created_at: comment.created_at ?? '',
    };
  });
}

/** Newest first, as the feed is read. */
export function mergeFeed(a: readonly ActivityRow[], b: readonly ActivityRow[]): ActivityRow[] {
  return [...a, ...b].sort((x, y) => y.created_at.localeCompare(x.created_at));
}
