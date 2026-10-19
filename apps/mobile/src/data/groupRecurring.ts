/**
 * Repeating group expenses (a flat's monthly rent), read local-first and written
 * through the offline queue like the trip plan.
 *
 * The rule is the only thing the phone writes. The expenses it produces are
 * posted by the server generator on their dates, so a rule made on one phone can
 * never double-post when another comes back online; `useRecurringCatchUp` just
 * asks the server to run that same generator for this person's groups when the
 * app opens, so nothing waits on the schedule.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';

import {
  buildGroupRecurringCreate,
  groupRecurringFromRow,
  materialiseGroupRecurring,
  materialiseMembers,
  MutationKind,
  type GroupRecurringPatch,
  type GroupRecurringRule,
  type GroupRecurringTemplate,
  type GroupRecurringWhen,
} from '@waves/core';

import { todayIso } from '@/data/personal';
import { isViewer, type MemberRow } from '@/data/types';
import { useAuth } from '@/lib/auth';
import { backend } from '@/lib/backend';
import { reportHandled } from '@/lib/observability';
import { useSync } from '@/sync';

/** The group's repeating rules, newest first, with queued changes shown. */
export function useGroupRecurring(groupId: string): {
  readonly rules: readonly GroupRecurringRule[];
  readonly isLoading: boolean;
} {
  const { mirror, queue, hydrated } = useSync();
  const { profile } = useAuth();
  const rules = useMemo(() => {
    const myMemberId =
      (materialiseMembers(mirror, queue, { groupId }) as unknown as MemberRow[]).find(
        (member) => isViewer(member, profile?.id) && member.left_at === null,
      )?.id ?? null;
    return materialiseGroupRecurring(mirror, queue, { groupId, myMemberId, today: todayIso() }).map(
      (row) => groupRecurringFromRow(row as never),
    );
  }, [mirror, queue, groupId, profile?.id]);
  return { rules, isLoading: !hydrated };
}

/** Make a rule. Resolves to the new rule's id. */
export function useCreateGroupRecurring(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: async (input: {
      /** Derived from what the rule repeats, so a retry finds the same rule. */
      ruleId: string;
      template: GroupRecurringTemplate;
      when: GroupRecurringWhen;
    }): Promise<string> => {
      const ruleId = input.ruleId;
      await mutate(MutationKind.GroupRecurringCreate, groupId, {
        ...buildGroupRecurringCreate(ruleId, input.template, input.when),
      });
      return ruleId;
    },
  });
}

/** Edit, pause, resume or stop one rule. */
export function useUpdateGroupRecurring(groupId: string) {
  const { mutate } = useSync();
  return useMutation({
    mutationFn: (input: { ruleId: string; patch: GroupRecurringPatch }) =>
      mutate(MutationKind.GroupRecurringUpdate, groupId, {
        ruleId: input.ruleId,
        patch: { ...input.patch },
      }),
  });
}

/**
 * Once per app open, ask the server to post whatever of this person's groups'
 * repeating expenses has come due, then pull the result. Idempotent on the
 * server, so a second phone, the schedule and this all agree. Silent on failure
 * (offline is the normal case): the schedule or the next open does it.
 */
export function useRecurringCatchUp(): void {
  const { session } = useAuth();
  const { flush, hydrated } = useSync();
  const done = useRef<string | null>(null);
  const userId = session?.user?.id ?? null;
  useEffect(() => {
    if (!userId || !hydrated || done.current === userId) return;
    done.current = userId;
    void (async () => {
      try {
        const { data, error } = await backend.rpc('waves_generate_my_recurring_expenses', {
          p_today: todayIso(),
        });
        if (error) return;
        if (((data as { generated?: number } | null)?.generated ?? 0) > 0) await flush();
      } catch (caught) {
        reportHandled(caught, 'recurring.catchUp');
      }
    })();
  }, [userId, hydrated, flush]);
}
