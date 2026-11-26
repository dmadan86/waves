import type { ExpenseComment } from '@waves/api-client';

import { supabase } from '@/lib/waves';

/**
 * An admin removing someone. The RPC stamps the removal, so the activity trail
 * says "removed" rather than "left" (a plain `left_at` update reads as leaving).
 */
export async function removeMember(memberId: string): Promise<void> {
  const { error } = await supabase.rpc('waves_remove_member', { p_member_id: memberId });
  if (error) throw error;
}

/** Every live comment in a group, for the activity feed. */
export async function groupComments(groupId: string): Promise<ExpenseComment[]> {
  const { data, error } = await supabase
    .from('expense_comments')
    .select(
      'id, group_id, expense_id, author_member_id, body, edited_at, flagged_at, flagged_by, created_at',
    )
    .eq('group_id', groupId)
    .is('deleted_at', null);
  if (error) throw error;
  return (data ?? []) as ExpenseComment[];
}
