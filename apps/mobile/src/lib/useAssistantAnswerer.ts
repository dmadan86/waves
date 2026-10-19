/**
 * The assistant's money-question answerer, bound to the phone's data.
 *
 * `parse` is free and synchronous (pure text). `answer` reads the local mirror
 * and the personal ledger when it is called, not on every render, so a screen
 * that mounts this hook and never gets a money question pays nothing.
 */

import { useCallback, useMemo } from 'react';

import {
  materialiseExpenses,
  materialiseGroups,
  materialiseMembers,
  type SpendCatalogEntry,
  type SpendPeriodKey,
  type SpendQuery,
} from '@waves/core';

import { useCategoryCatalog } from '@/data/hooks';
import { todayIso, usePersonalLedger } from '@/data/personal';
import { isViewer, type ExpenseRow, type GroupRow, type MemberRow } from '@/data/types';
import { useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import {
  answerForPeriod,
  answerMoneyQuestion,
  parseMoneyQuestion,
  type AnswerContext,
  type AnswerGroupInput,
  type AssistantAnswer,
} from '@/lib/assistantAnswers';
import { useSync } from '@/sync';

export interface AssistantAnswerer {
  /** The question as a spend query, or null when the text is something else. */
  parse: (text: string) => SpendQuery | null;
  answer: (query: SpendQuery) => AssistantAnswer;
  answerFor: (query: SpendQuery, period: SpendPeriodKey) => AssistantAnswer;
}

export function useAssistantAnswerer(): AssistantAnswerer {
  const { t, locale } = useStrings();
  const { mirror, queue } = useSync();
  const ledger = usePersonalLedger();
  const viewerId = useViewerId();
  const labelFor = useCallback((id: string) => t.categories[id as keyof typeof t.categories], [t]);
  const catalog = useCategoryCatalog(labelFor);

  const context = useCallback((): AnswerContext => {
    const groups: AnswerGroupInput[] = [];
    for (const group of materialiseGroups(mirror, queue) as unknown as GroupRow[]) {
      const members = materialiseMembers(mirror, queue, {
        groupId: group.id,
      }) as unknown as MemberRow[];
      const names = new Map(
        members.map((m) => [m.id, m.profile?.display_name ?? m.ghost_name ?? ''] as const),
      );
      groups.push({
        id: group.id,
        name: group.name?.trim() || '',
        archived: group.archived_at !== null,
        myMemberIds: members.filter((m) => isViewer(m, viewerId)).map((m) => m.id),
        expenses: materialiseExpenses(mirror, queue, { groupId: group.id }).flatMap((raw) => {
          const expense = raw as unknown as ExpenseRow;
          const v = expense.currentVersion;
          if (!v) return [];
          return [
            {
              id: expense.id,
              deleted: expense.deleted_at !== null,
              description: v.description,
              notes: v.notes,
              payee: v.payee ?? null,
              category: v.category,
              categoryLabel: v.category_meta?.label ?? null,
              date: v.expense_date,
              currency: v.currency,
              shares: v.shares.map((s) => ({ memberId: s.member_id, amount: s.amount })),
              memberNames: v.shares
                .map((s) => names.get(s.member_id) ?? '')
                .filter((name) => name !== ''),
            },
          ];
        }),
      });
    }
    const entries: SpendCatalogEntry[] = catalog.all.map((entry) => ({
      key: entry.key,
      label: entry.label,
      builtinId: entry.builtinId,
    }));
    return {
      today: todayIso(),
      locale,
      strings: t.voice,
      categoryNames: t.categories,
      viewerId: viewerId ?? undefined,
      data: { txns: ledger.txns, budgets: ledger.budgets, groups, catalog: entries },
    };
  }, [mirror, queue, ledger, viewerId, catalog.all, locale, t]);

  const parse = useCallback((text: string) => parseMoneyQuestion(text, todayIso()), []);
  const answer = useCallback(
    (query: SpendQuery) => answerMoneyQuestion(query, context()),
    [context],
  );
  const answerFor = useCallback(
    (query: SpendQuery, period: SpendPeriodKey) => answerForPeriod(query, period, context()),
    [context],
  );

  return useMemo(() => ({ parse, answer, answerFor }), [parse, answer, answerFor]);
}
