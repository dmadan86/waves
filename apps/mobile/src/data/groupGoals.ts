/**
 * Joint goals: a group puts money aside together toward one thing. Read
 * local-first from the mirror (with queued changes shown), written through the
 * offline queue. Goals work in any group, split or pooled.
 */

import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';

import {
  materialiseGroupGoals,
  materialiseMembers,
  MutationKind,
  putAsideTotal,
  type CurrencyCode,
  type GoalLine,
  type GoalShape,
} from '@waves/core';

import { isViewer, type MemberRow } from '@/data/types';
import { useAuth } from '@/lib/auth';
import { useSync } from '@/sync';

export interface GroupGoal extends GoalShape {
  readonly id: string;
  readonly name: string;
  readonly emoji: string | null;
  readonly currency: CurrencyCode;
  readonly forMemberId: string | null;
  readonly status: 'active' | 'done' | 'archived';
  readonly pending: boolean;
}

export interface GroupGoalLine extends GoalLine {
  readonly id: string;
  readonly goalId: string;
  readonly note: string | null;
  readonly pending: boolean;
}

export interface GroupGoalView {
  readonly goal: GroupGoal;
  readonly lines: readonly GroupGoalLine[];
  readonly total: bigint;
}

export function useGroupGoals(groupId: string): {
  readonly goals: readonly GroupGoalView[];
  readonly myMemberId: string | null;
  readonly isLoading: boolean;
} {
  const { mirror, queue, hydrated } = useSync();
  const { profile } = useAuth();
  const built = useMemo(() => {
    const myMemberId =
      (materialiseMembers(mirror, queue, { groupId }) as unknown as MemberRow[]).find(
        (member) => isViewer(member, profile?.id) && member.left_at === null,
      )?.id ?? null;
    const rows = materialiseGroupGoals(mirror, queue, { groupId, myMemberId });
    const goals: GroupGoalView[] = rows.goals.map((row) => {
      const goal: GroupGoal = {
        id: row.id,
        name: row.name,
        emoji: row.emoji,
        currency: row.currency as CurrencyCode,
        targetMinor: BigInt(String(row.target_minor)),
        targetDate: row.target_date,
        createdAt: row.created_at,
        forMemberId: row.for_member_id,
        monthlyPlan: Object.fromEntries(
          Object.entries(row.monthly_plan ?? {}).map(([id, minor]) => [id, BigInt(String(minor))]),
        ),
        status: row.status,
        pending: row.pending === true,
      };
      const lines = rows.contributions
        .filter((line) => line.goal_id === row.id)
        .map((line): GroupGoalLine => ({
          id: line.id,
          goalId: line.goal_id,
          memberId: line.member_id,
          amountMinor: BigInt(String(line.amount_minor)),
          date: line.date,
          note: line.note,
          pending: line.pending === true,
        }));
      return { goal, lines, total: putAsideTotal(goal, lines) };
    });
    return { goals, myMemberId };
  }, [mirror, queue, groupId, profile?.id]);
  return { ...built, isLoading: !hydrated };
}

export interface GoalInput {
  readonly name: string;
  readonly emoji: string | null;
  readonly targetMinor: bigint;
  readonly currency: CurrencyCode;
  readonly targetDate: string | null;
  readonly forMemberId: string | null;
  readonly monthlyPlan: Readonly<Record<string, bigint>>;
}

/** Make a goal, or edit one (`goalId` given). Resolves to the goal's id. */
export function useSetGoal(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: async (input: GoalInput & { goalId?: string }): Promise<string> => {
      const goalId = input.goalId ?? randomUUID();
      await mutate(MutationKind.GroupGoalSet, groupId, {
        goalId,
        name: input.name.trim(),
        emoji: input.emoji,
        targetMinor: input.targetMinor.toString(),
        currency: input.currency,
        targetDate: input.targetDate,
        forMemberId: input.forMemberId,
        monthlyPlan: Object.fromEntries(
          Object.entries(input.monthlyPlan)
            .filter(([, minor]) => minor > 0n)
            .map(([id, minor]) => [id, Number(minor)]),
        ),
      });
      return goalId;
    },
  });
}

export function useArchiveGoal(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: { goalId: string; status: 'active' | 'done' | 'archived' }) =>
      mutate(MutationKind.GroupGoalArchive, groupId, { ...input }),
  });
}

/** Put money aside (positive) or take it out (negative). */
export function useAddContribution(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: {
      goalId: string;
      memberId: string;
      amountMinor: bigint;
      date: string;
      note?: string | null;
    }) =>
      mutate(MutationKind.GroupGoalContributionAdd, groupId, {
        contributionId: randomUUID(),
        goalId: input.goalId,
        memberId: input.memberId,
        amountMinor: input.amountMinor.toString(),
        date: input.date,
        note: input.note ?? null,
      }),
  });
}

export function useVoidContribution(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (contributionId: string) =>
      mutate(MutationKind.GroupGoalContributionVoid, groupId, { contributionId }),
  });
}
