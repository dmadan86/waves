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
  format,
  isPoolGroup,
  materialiseGroup,
  materialiseGroups,
  money,
  type CurrencyCode,
  materialiseGroupRecurring,
  materialiseMembers,
  MutationKind,
  poolSplit,
  type GroupRecurringPatch,
  type GroupRecurringRule,
  type GroupRecurringTemplate,
  type GroupRecurringWhen,
} from '@waves/core';

import { todayIso } from '@/data/personal';
import { isViewer, type MemberRow } from '@/data/types';
import { useAuth } from '@/lib/auth';
import { backend } from '@/lib/backend';
import { fill, useStrings } from '@/i18n';
import { groupBillsForPayer, type PayerBill } from '@/lib/householdBills';
import { syncBillReminders } from '@/lib/householdBillReminders';
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
  const { mutate, mirror, queue } = useSync();
  return useMutation({
    mutationFn: async (input: {
      /** Derived from what the rule repeats, so a retry finds the same rule. */
      ruleId: string;
      template: GroupRecurringTemplate;
      when: GroupRecurringWhen;
    }): Promise<string> => {
      const ruleId = input.ruleId;
      // Share it: a shared bill is paid from the pot, so nobody owes the payer.
      const template = isPoolGroup(materialiseGroup(mirror, queue, groupId) as never)
        ? { ...input.template, ...poolSplit(input.template.payers) }
        : input.template;
      await mutate(MutationKind.GroupRecurringCreate, groupId, {
        ...buildGroupRecurringCreate(ruleId, template, input.when),
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

/**
 * Share-it households: local reminders (3 days before and on the day, 10:00) for
 * the shared bills this person pays, across every pooled group. Re-planned when
 * the bills change; never asks for permission.
 */
export function useHouseholdBillReminders(): void {
  const { mirror, queue, hydrated } = useSync();
  const { profile } = useAuth();
  const { t, locale } = useStrings();
  const { bills, names } = useMemo(() => {
    const all: PayerBill[] = [];
    const nameByGroup = new Map<string, string>();
    for (const group of materialiseGroups(mirror, queue)) {
      if (!isPoolGroup(group as never)) continue;
      const me = (
        materialiseMembers(mirror, queue, { groupId: group.id }) as unknown as MemberRow[]
      ).find((member) => isViewer(member, profile?.id) && member.left_at === null);
      if (!me) continue;
      nameByGroup.set(group.id, (group as { name?: string | null }).name ?? '');
      const rules = materialiseGroupRecurring(mirror, queue, {
        groupId: group.id,
        myMemberId: me.id,
        today: todayIso(),
      }).map((row) => groupRecurringFromRow(row as never));
      all.push(...groupBillsForPayer(rules, me.id));
    }
    return { bills: all, names: nameByGroup };
  }, [mirror, queue, profile?.id]);
  const signature = bills.map((b) => `${b.ruleId}:${b.date}:${b.amount}`).join('|');
  useEffect(() => {
    if (!hydrated) return;
    const amountText = (b: PayerBill): string =>
      format(money(b.amount, b.currency as CurrencyCode), { locale });
    void syncBillReminders(bills, {
      title: (b, kind) =>
        fill(kind === 'today' ? t.household.reminderToday : t.household.reminderAhead, {
          bill: b.description,
        }),
      body: (b) =>
        fill(t.household.reminderBody, {
          amount: amountText(b),
          group: names.get(b.groupId) ?? '',
        }),
    });
    // `signature` stands for `bills`: re-plan only when a bill actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, signature, locale]);
}
