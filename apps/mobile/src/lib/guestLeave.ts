import { leaveUntouchedGuestGroups } from '@waves/core';

import { leaveGroup } from '@/data/api';
import { backend } from '@/lib/backend';
import { reportHandled } from '@/lib/observability';

/**
 * Whether a membership has anything attached: an expense it created, a share,
 * a payment or a settlement. A failed read counts as "yes", so a guest only
 * ever leaves a group it demonstrably never touched.
 */
async function memberHasHistory(memberId: string): Promise<boolean> {
  const counts = await Promise.all([
    backend
      .from('expenses')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', memberId),
    backend
      .from('expense_shares')
      .select('member_id', { count: 'exact', head: true })
      .eq('member_id', memberId),
    backend
      .from('expense_payers')
      .select('member_id', { count: 'exact', head: true })
      .eq('member_id', memberId),
    backend
      .from('settlements')
      .select('id', { count: 'exact', head: true })
      .or(`from_member_id.eq.${memberId},to_member_id.eq.${memberId}`),
  ]);
  return counts.some(({ count, error }) => Boolean(error) || count === null || count > 0);
}

/**
 * Take the guest out of the groups it only joined, before it signs out: the
 * switch joins the real account to them again, and a guest left behind shows
 * the same person twice. The rule is `leaveUntouchedGuestGroups` in @waves/core.
 */
export async function leaveGuestGroups(guestId: string): Promise<void> {
  await leaveUntouchedGuestGroups({
    memberships: async () => {
      const { data, error } = await backend
        .from('group_members')
        .select('id, joined_via')
        .eq('profile_id', guestId)
        .is('left_at', null);
      if (error) throw error;
      return ((data ?? []) as { id: string; joined_via: string | null }[]).map((row) => ({
        memberId: row.id,
        joinedVia: row.joined_via,
      }));
    },
    hasHistory: memberHasHistory,
    leave: leaveGroup,
    report: (error) => reportHandled(error, 'auth.switchLeave'),
  });
}
