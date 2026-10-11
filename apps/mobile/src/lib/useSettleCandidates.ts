/**
 * The groups Settle up offers: the ones with money outstanding either way,
 * largest balance first. One definition for the `/settle-up` screen, which
 * both Home and Friends now open, so the two entry points cannot drift.
 */

import { useMemo } from 'react';

import type { SettleCandidate } from '@/components/home/SettleGroupList';
import { useGroups, useHomeSummary } from '@/data/hooks';
import { groupLabel, isViewer } from '@/data/types';
import { useAuth } from '@/lib/auth';

export function useSettleCandidates(): SettleCandidate[] {
  const { profile } = useAuth();
  const groups = useGroups();
  const summary = useHomeSummary(profile?.id ?? null);
  return useMemo(() => {
    const me = profile?.id ?? null;
    return groups.data
      .map((group) => {
        const members = summary.membersFor(group.id);
        return {
          id: group.id,
          title: groupLabel(group, members, me),
          coverEmoji: group.cover_emoji,
          photoPath: group.photo_path,
          balance: summary.balanceFor(group.id),
          currency: group.default_currency,
          memberCount: summary.memberCountFor(group.id),
          lastActivityAt: summary.lastActivityFor(group.id),
          type: group.type,
          // Groups carry no creator column, so "yours" is the admin role.
          isAdmin: me
            ? members.some((m) => isViewer(m, me) && m.role === 'admin' && !m.left_at)
            : false,
        };
      })
      .filter((group) => group.balance !== 0n)
      .sort((a, b) => {
        const size = (x: bigint) => (x < 0n ? -x : x);
        const d = size(b.balance) - size(a.balance);
        return d > 0n ? 1 : d < 0n ? -1 : 0;
      });
  }, [groups.data, summary, profile?.id]);
}
