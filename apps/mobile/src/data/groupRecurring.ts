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

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { AppState } from 'react-native';
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
import { serialiseExpense } from '@/data/serialiseExpense';
import {
  groupBillsForPayer,
  createReplanner,
  hexToUuid,
  occurrenceSeed,
  type PayerBill,
} from '@/lib/householdBills';
import { syncBillReminders } from '@/lib/householdBillReminders';
import { reportHandled } from '@/lib/observability';
import { syncEngine, useSync } from '@/sync';

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
    onSuccess: () => replanBillReminders(),
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
    onSuccess: () => replanBillReminders(),
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

type BillCollect = { bills: PayerBill[]; names: Map<string, string> };

/** Every shared bill this person pays, across their pooled groups, from the given local state. */
function collectBills(
  mirror: Parameters<typeof materialiseGroups>[0],
  queue: Parameters<typeof materialiseGroups>[1],
  profileId: string | undefined,
): BillCollect {
  const bills: PayerBill[] = [];
  const names = new Map<string, string>();
  for (const group of materialiseGroups(mirror, queue)) {
    if (!isPoolGroup(group as never)) continue;
    const me = (
      materialiseMembers(mirror, queue, { groupId: group.id }) as unknown as MemberRow[]
    ).find((member) => isViewer(member, profileId) && member.left_at === null);
    if (!me) continue;
    names.set(group.id, (group as { name?: string | null }).name ?? '');
    const rules = materialiseGroupRecurring(mirror, queue, {
      groupId: group.id,
      myMemberId: me.id,
      today: todayIso(),
    }).map((row) => groupRecurringFromRow(row as never));
    bills.push(...groupBillsForPayer(rules, me.id));
  }
  return { bills, names };
}

// What the last mounted hook knew (language, who is signed in): the re-plan reads
// the live local state itself, so it works after a bill change anywhere in the app.
let replanContext: {
  profileId: string | undefined;
  locale: string;
  t: ReturnType<typeof useStrings>['t'];
} | null = null;

const replanBillReminders = createReplanner(async () => {
  const ctx = replanContext;
  const state = syncEngine.getState();
  if (!ctx || !state.hydrated) return;
  const { bills, names } = collectBills(state.mirror, state.queue, ctx.profileId);
  await syncBillReminders(bills, {
    title: (b, kind) =>
      fill(kind === 'today' ? ctx.t.household.reminderToday : ctx.t.household.reminderAhead, {
        bill: b.description,
      }),
    body: (b) =>
      fill(ctx.t.household.reminderBody, {
        amount: format(money(b.amount, b.currency as CurrencyCode), { locale: ctx.locale }),
        group: names.get(b.groupId) ?? '',
      }),
  });
}, 1500);

/**
 * Share-it households: local reminders (3 days before and on the day, 10:00) for
 * the shared bills this person pays, across every pooled group. Re-planned (debounced,
 * one at a time) when the bills change, after a bill is added, edited or removed,
 * and when the app comes to the foreground; never asks for permission.
 */
export function useHouseholdBillReminders(): void {
  const { mirror, queue, hydrated } = useSync();
  const { profile } = useAuth();
  const { t, locale } = useStrings();
  const profileId = profile?.id;
  const signature = useMemo(
    () =>
      collectBills(mirror, queue, profileId)
        .bills.map((b) => `${b.ruleId}:${b.date}:${b.amount}`)
        .join('|'),
    [mirror, queue, profileId],
  );
  useEffect(() => {
    replanContext = { profileId, locale, t };
    if (hydrated) replanBillReminders();
  }, [hydrated, signature, locale, profileId, t]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') replanBillReminders();
    });
    return () => sub.remove();
  }, []);
}

/** The ids the server's generator gives one occurrence, so a paid bill and the generated one are the same expense. */
export async function occurrenceIds(
  ruleId: string,
  date: string,
): Promise<{ expenseId: string; mutationId: string }> {
  const id = async (kind: 'expense' | 'mutation'): Promise<string> =>
    hexToUuid(
      await digestStringAsync(CryptoDigestAlgorithm.MD5, occurrenceSeed(kind, ruleId, date)),
    );
  return { expenseId: await id('expense'), mutationId: await id('mutation') };
}

/**
 * Mark one bill occurrence paid: post it as a group expense now. It takes the
 * generator's own ids for (rule, date), so tapping twice, or the server posting
 * it later on the day, replays the same expense instead of adding another.
 */
export function useMarkBillPaid(groupId: string) {
  const { mutate, flush } = useSync();
  return useCallback(
    async (rule: GroupRecurringRule, date: string): Promise<void> => {
      const { expenseId, mutationId } = await occurrenceIds(rule.id, date);
      await mutate(
        MutationKind.ExpenseCreate,
        groupId,
        {
          ...serialiseExpense({
            description: rule.description,
            category: rule.category,
            expenseDate: date,
            currency: rule.currency,
            amount: rule.amount,
            splitParams: rule.splitParams,
            participants: [...rule.participants],
            payers: { ...rule.payers },
            notes: rule.notes,
          }),
          expenseId,
        },
        mutationId,
      );
      void flush([groupId]);
    },
    [mutate, flush, groupId],
  );
}
