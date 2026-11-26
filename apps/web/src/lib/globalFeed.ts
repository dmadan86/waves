import type { ActivityGroup, ActivityRow, ExpenseComment, Member } from '@waves/api-client';

import { commentRows, mergeFeed } from '@/lib/commentActivity';
import type { ExpenseFigures } from '@/lib/activity';

export type FeedRow = ActivityRow & { group: ActivityGroup | null };

export interface FeedExpense {
  id: string;
  currentVersion: { description: string; amount: string | bigint; currency: string } | null;
}

/**
 * The cross-group feed the way the group's Activity tab tells it: comments
 * joined in, and delete/restore rows naming the expense (their payload is empty).
 */
export function buildFeed(
  activity: readonly FeedRow[],
  comments: readonly ExpenseComment[],
  members: readonly Member[],
  expenses: readonly FeedExpense[],
): { rows: FeedRow[]; names: Map<string, string>; figures: ExpenseFigures } {
  const names = new Map<string, string>();
  const figures = new Map<string, { amount: string | bigint; currency: string }>();
  for (const e of expenses) {
    if (!e.currentVersion) continue;
    if (e.currentVersion.description) names.set(e.id, e.currentVersion.description);
    figures.set(e.id, { amount: e.currentVersion.amount, currency: e.currentVersion.currency });
  }
  const groups = new Map(
    activity.flatMap((r) => (r.group ? [[r.group_id, r.group] as const] : [])),
  );
  const extra = commentRows(comments, members, names).map((row) => ({
    ...row,
    group: groups.get(row.group_id) ?? null,
  }));
  return { rows: mergeFeed(activity, extra) as FeedRow[], names, figures };
}

/** What a feed needs beyond its own rows: the comments and the expenses they and the deletes name. */
export async function loadFeedExtras(
  activity: readonly FeedRow[],
): Promise<{ comments: ExpenseComment[]; expenses: FeedExpense[] }> {
  // Loaded on demand so the pure half above can be used (and tested) without a client.
  const { supabase } = await import('@/lib/waves');
  const { data: commentData } = await supabase
    .from('expense_comments')
    .select(
      'id, group_id, expense_id, author_member_id, body, edited_at, flagged_at, flagged_by, created_at',
    )
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(100);
  const comments = (commentData ?? []) as ExpenseComment[];
  const ids = new Set<string>(comments.map((c) => c.expense_id));
  for (const row of activity) {
    if (row.object_id && (row.verb === 'deleted' || row.verb === 'restored'))
      ids.add(row.object_id);
  }
  if (ids.size === 0) return { comments, expenses: [] };
  const { data } = await supabase
    .from('expenses')
    .select(
      'id, currentVersion:expense_versions!expenses_current_version_id_fkey ( description, amount, currency )',
    )
    .in('id', [...ids]);
  return { comments, expenses: (data ?? []) as unknown as FeedExpense[] };
}
