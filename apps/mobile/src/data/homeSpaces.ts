/**
 * What the Home "Spaces" grid needs beyond a group's balance: for a shared-pool
 * group (couple, family, home) the month's budget left and the next bill, and
 * the shared bills this person pays (the "Needs you" card). Read straight from
 * the local mirror, the same way `useHouseholdBillReminders` does.
 */

import { useMemo } from 'react';

import {
  groupRecurringFromRow,
  isPoolGroup,
  materialiseExpenses,
  materialiseGroupRecurring,
  materialiseGroups,
  materialiseMembers,
  type GroupRecurringRule,
} from '@waves/core';

import { todayIso } from '@/data/personal';
import { toSnapshot } from '@/data/hooks';
import { isViewer, type ExpenseRow, type MemberRow } from '@/data/types';
import { useAuth } from '@/lib/auth';
import { groupBillsForPayer, type PayerBill } from '@/lib/householdBills';
import { monthSpend } from '@/lib/householdHome';
import { useSync } from '@/sync';

export interface PoolFigure {
  readonly currency: string;
  /** Budget minus this month's spend; null with no budget set. */
  readonly left: bigint | null;
  readonly nextBill: {
    readonly description: string;
    readonly amount: bigint;
    readonly date: string;
  } | null;
  readonly spent: bigint;
}

export function useHomeSpaceFigures(): {
  readonly pool: ReadonlyMap<string, PoolFigure>;
  readonly myBills: readonly PayerBill[];
} {
  const { mirror, queue } = useSync();
  const { profile } = useAuth();
  return useMemo(() => {
    const today = todayIso();
    const pool = new Map<string, PoolFigure>();
    const myBills: PayerBill[] = [];
    for (const group of materialiseGroups(mirror, queue)) {
      if (!isPoolGroup(group as never)) continue;
      const row = group as unknown as {
        id: string;
        default_currency?: string | null;
        budget_minor?: string | null;
      };
      const currency = row.default_currency ?? 'INR';
      const me = (
        materialiseMembers(mirror, queue, { groupId: row.id }) as unknown as MemberRow[]
      ).find((member) => isViewer(member, profile?.id) && member.left_at === null);
      const rules: GroupRecurringRule[] = materialiseGroupRecurring(mirror, queue, {
        groupId: row.id,
        myMemberId: me?.id ?? null,
        today,
      }).map((r) => groupRecurringFromRow(r as never));
      const active = rules
        .filter((r) => r.status === 'active')
        .sort((a, b) => (a.nextDate < b.nextDate ? -1 : a.nextDate > b.nextDate ? 1 : 0));
      const spent = monthSpend(
        materialiseExpenses(mirror, queue, { groupId: row.id })
          .map((e) => toSnapshot(e as unknown as ExpenseRow))
          .filter((s) => s !== null && !s.deletedAt)
          .map((s) => ({ date: s!.date, amount: s!.amount, currency: s!.currency })),
        today.slice(0, 7),
        currency,
      );
      const budget =
        row.budget_minor === null || row.budget_minor === undefined
          ? null
          : BigInt(row.budget_minor);
      const first = active[0];
      pool.set(row.id, {
        currency,
        spent,
        left: budget === null ? null : budget > spent ? budget - spent : 0n,
        nextBill: first
          ? { description: first.description, amount: first.amount, date: first.nextDate }
          : null,
      });
      if (me) myBills.push(...groupBillsForPayer(rules, me.id));
    }
    return { pool, myBills };
  }, [mirror, queue, profile?.id]);
}
