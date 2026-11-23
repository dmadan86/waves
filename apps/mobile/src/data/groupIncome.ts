/**
 * Household income plans: what each member (a partner, a parent, a grown child,
 * with or without an account) plans to bring in each month. Read local-first
 * from the mirror, written through the offline queue. A plan, never an expense:
 * nothing here touches balances.
 */

import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';

import {
  materialiseGroupIncome,
  materialiseMembers,
  MutationKind,
  type CurrencyCode,
  type IncomeKind,
  type IncomePlanLike,
} from '@waves/core';

import { isViewer, type MemberRow } from '@/data/types';
import { useAuth } from '@/lib/auth';
import { useSync } from '@/sync';

export interface IncomePlan extends IncomePlanLike {
  readonly id: string;
  readonly label: string;
  readonly kind: IncomeKind;
  readonly dayOfMonth: number;
  readonly pending: boolean;
}

export function useGroupIncome(groupId: string): {
  readonly plans: readonly IncomePlan[];
  readonly isLoading: boolean;
} {
  const { mirror, queue, hydrated } = useSync();
  const { profile } = useAuth();
  const plans = useMemo(() => {
    const myMemberId =
      (materialiseMembers(mirror, queue, { groupId }) as unknown as MemberRow[]).find(
        (member) => isViewer(member, profile?.id) && member.left_at === null,
      )?.id ?? null;
    return materialiseGroupIncome(mirror, queue, { groupId, myMemberId }).map(
      (row): IncomePlan => ({
        id: row.id,
        memberId: row.member_id,
        label: row.label,
        kind: row.kind,
        amount: BigInt(String(row.amount_minor)),
        currency: row.currency,
        dayOfMonth: row.day_of_month,
        active: row.active,
        pending: row.pending === true,
      }),
    );
  }, [mirror, queue, groupId, profile?.id]);
  return { plans, isLoading: !hydrated };
}

export interface IncomeInput {
  readonly memberId: string;
  readonly label: string;
  readonly kind: IncomeKind;
  readonly amount: bigint;
  readonly currency: CurrencyCode;
  readonly dayOfMonth: number;
  readonly active?: boolean;
}

/** Make a plan, or edit one (`planId` given). Resolves to the plan's id. */
export function useSetIncome(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: async (input: IncomeInput & { planId?: string }): Promise<string> => {
      const planId = input.planId ?? randomUUID();
      await mutate(MutationKind.GroupIncomeSet, groupId, {
        planId,
        memberId: input.memberId,
        label: input.label.trim(),
        kind: input.kind,
        amountMinor: input.amount.toString(),
        currency: input.currency,
        dayOfMonth: input.dayOfMonth,
        active: input.active ?? true,
      });
      return planId;
    },
  });
}

export function useDeleteIncome(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (planId: string) => mutate(MutationKind.GroupIncomeDelete, groupId, { planId }),
  });
}
