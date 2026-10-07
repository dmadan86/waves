/**
 * The advanced voice flow (Pro, behind the `voice_agent` flag): the sentence the mic
 * just streamed goes to the `voice-agent` function, and what comes back is shown
 * as one confirmation card per proposed action — nothing is written until a
 * person taps Confirm. Each confirmed action runs through the same hooks the rest
 * of the app writes with, so the offline queue and sync behave as everywhere else.
 *
 * If the agent cannot be reached or the allowance is spent, the panel hands the
 * transcript back to the screen (`onFallback`), which carries on with
 * the basic path exactly as it does without the flag.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { randomUUID } from 'expo-crypto';
import { ActivityIndicator, View } from 'react-native';

import {
  encodeTxn,
  guessCategory,
  materialiseGroups,
  materialiseMembers,
  type VoiceAgentAction,
} from '@waves/core';
import { Button, Card, Divider, Row, Text, useTheme } from '@waves/ui';

import { nudgeToSettle } from '@/data/api';
import {
  useAddGhostMember,
  useCreateGroup,
  useRecordSettlement,
  useWriteExpense,
} from '@/data/hooks';
import { useUpsertPersonalRecord } from '@/data/personal';
import { GroupType, isViewer, type GroupRow, type MemberRow } from '@/data/types';
import { fill, useStrings, type UiStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { router } from '@/lib/navigation';
import { encodeAgentSplitParams } from '@/lib/voiceAgentHandoff';
import { sendVoiceTranscript } from '@/lib/voiceAgent';
import {
  expenseWriteFromAction,
  planVoiceAgentActions,
  quotaLeft,
  type AgentCard,
  type AgentLocalData,
  type AgentLocalGroup,
  type AgentPlan,
  type VoiceAgentText,
} from '@/lib/voiceAgentPlan';
import { useToast } from '@/lib/toast';
import { useSync } from '@/sync';

export type AgentFallbackReason = 'quota' | 'other';

export interface VoiceAgentPanelProps {
  /** What the mic heard (streamed live) — sent to the agent, and what the fallback carries on with. */
  transcript: string;
  /** The group the mic was opened from, if any. */
  groupId: string | null;
  today: string;
  /** The agent could not help; run the basic on-device path instead. */
  onFallback: (reason: AgentFallbackReason) => void;
  /** Open the mic again. After a clarifying question, `followUp` carries what
   *  was said and asked, so the next clip is read as the answer. */
  onRetry: (followUp?: { transcript: string; question: string }) => void;
  /** This clip answers the agent's earlier question. */
  followUp?: { transcript: string; question: string } | null;
  /** Everything is confirmed or discarded. */
  onClose: () => void;
}

type CardStatus = 'pending' | 'running' | 'done' | 'failed' | 'discarded';

function agentText(t: UiStrings): VoiceAgentText {
  const v = t.voice;
  return {
    add: v.agentAdd,
    paid: v.agentPaid,
    you: v.agentYou,
    splitEqual: v.agentSplitEqual,
    splitJustPayer: v.agentNotSplit,
    splitExact: v.agentSplitExact,
    splitPercent: v.agentSplitPercent,
    splitShares: v.agentSplitShares,
    justYou: v.agentJustYou,
    settle: v.agentSettle,
    remind: v.agentRemind,
    createGroup: v.agentCreateGroup,
    withPeople: v.agentWithPeople,
    addMember: v.agentAddMember,
    unknownGroup: v.agentUnknownGroup,
    unknownPerson: v.agentUnknownPerson,
  };
}

/** The reader's groups and who is in them, read from the local mirror. */
function useAgentLocalData(viewerId: string | null): AgentLocalData {
  const { mirror, queue } = useSync();
  return useMemo(() => {
    const groups: AgentLocalGroup[] = [];
    for (const group of materialiseGroups(mirror, queue) as unknown as GroupRow[]) {
      const members = (
        materialiseMembers(mirror, queue, { groupId: group.id }) as unknown as MemberRow[]
      ).filter((member) => member.left_at === null);
      groups.push({
        id: group.id,
        name: group.name?.trim() || '',
        currency: group.default_currency,
        members: members.map((member) => ({
          id: member.id,
          name: member.profile?.display_name ?? member.ghost_name ?? '',
          isViewer: isViewer(member, viewerId),
        })),
      });
    }
    return { groups };
  }, [mirror, queue, viewerId]);
}

const GROUP_TYPES: readonly string[] = Object.values(GroupType);

export function VoiceAgentPanel({
  transcript,
  groupId,
  today,
  onFallback,
  onRetry,
  followUp,
  onClose,
}: VoiceAgentPanelProps) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const viewerId = useViewerId();
  const local = useAgentLocalData(viewerId);
  const text = useMemo(() => agentText(t), [t]);

  const [response, setResponse] = useState<Awaited<ReturnType<typeof sendVoiceTranscript>> | null>(
    null,
  );
  const asked = useRef(false);
  // Latest callbacks, so the one call below never re-fires on a new closure.
  const fallbackRef = useRef(onFallback);
  useEffect(() => {
    fallbackRef.current = onFallback;
  });

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    let live = true;
    void sendVoiceTranscript({
      transcript,
      groupId,
      locale,
      today,
      followUp,
    }).then((result) => {
      if (!live) return;
      if (result.kind === 'ok') setResponse(result);
      else fallbackRef.current(result.kind === 'quota' ? 'quota' : 'other');
    });
    return () => {
      live = false;
    };
    // The sentence, group and locale are fixed for this panel's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const plan: AgentPlan | null = useMemo(
    () => (response?.kind === 'ok' ? planVoiceAgentActions(response.response, local, text) : null),
    [response, local, text],
  );

  const [status, setStatus] = useState<Record<string, CardStatus>>({});
  const statusOf = (key: string): CardStatus => status[key] ?? 'pending';
  const setCardStatus = useCallback((key: string, next: CardStatus): void => {
    setStatus((current) => ({ ...current, [key]: next }));
  }, []);
  const [confirmAllSeq, setConfirmAllSeq] = useState(0);

  const toast = useToast();
  // Everything handled — a Done button closes the screen.
  const settled =
    plan !== null &&
    plan.cards.length > 0 &&
    plan.cards.every((card) => ['done', 'discarded'].includes(statusOf(card.key)));
  const anyDone = plan?.cards.some((card) => statusOf(card.key) === 'done') ?? false;

  if (!plan) {
    return (
      <View style={{ alignItems: 'center', gap: theme.spacing.lg, paddingTop: theme.spacing.xxl }}>
        <ActivityIndicator color={theme.color.brand} />
        <Text tone="muted">{t.voice.agentUnderstanding}</Text>
      </View>
    );
  }

  const pending = plan.cards.filter(
    (card) => !card.problem && statusOf(card.key) === 'pending',
  ).length;
  const quota = quotaLeft(plan.quota);
  const nothing = plan.cards.length === 0 && !plan.answer && !plan.clarify;

  return (
    <View style={{ gap: theme.spacing.md }}>
      <Text variant="caption" tone="muted">
        {t.voice.agentHeard}: “{plan.transcript || transcript}”
      </Text>

      {plan.answer ? (
        <Card>
          <Text variant="subheading">{plan.answer}</Text>
        </Card>
      ) : null}

      {plan.clarify || nothing ? (
        <Card>
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="subheading">{t.voice.agentClarifyTitle}</Text>
            <Text tone="muted">{plan.clarify ?? t.voice.agentNothingToDo}</Text>
            <Button
              label={plan.clarify ? t.voice.agentAnswer : t.voice.agentTryAgain}
              variant="secondary"
              onPress={() =>
                onRetry(
                  plan.clarify
                    ? {
                        transcript: plan.transcript || transcript,
                        question: plan.clarify,
                      }
                    : undefined,
                )
              }
            />
          </View>
        </Card>
      ) : null}

      {plan.cards.length > 0 ? (
        <Card padded={false} style={{ overflow: 'hidden' }}>
          {plan.cards.map((card, index) => (
            <View key={card.key}>
              {index > 0 ? <Divider /> : null}
              <AgentActionCard
                card={card}
                local={local}
                today={today}
                status={statusOf(card.key)}
                onStatus={(next) => setCardStatus(card.key, next)}
                confirmAllSeq={confirmAllSeq}
                text={t.voice}
              />
            </View>
          ))}
        </Card>
      ) : null}

      {pending > 1 ? (
        <Button
          label={t.voice.agentConfirmAll}
          onPress={() => setConfirmAllSeq((current) => current + 1)}
        />
      ) : null}
      {settled ? (
        <Button
          label={t.voice.agentDone}
          onPress={() => {
            if (anyDone) toast.show(t.voice.agentDone);
            onClose();
          }}
        />
      ) : null}

      <Text variant="micro" tone="faint" style={{ textAlign: 'center' }}>
        {fill(t.voice.agentQuotaLeft, { left: String(quota.left), limit: String(quota.limit) })}
      </Text>
    </View>
  );
}

function AgentActionCard({
  card,
  local,
  today,
  status,
  onStatus,
  confirmAllSeq,
  text,
}: {
  card: AgentCard;
  local: AgentLocalData;
  today: string;
  status: CardStatus;
  onStatus: (next: CardStatus) => void;
  confirmAllSeq: number;
  text: UiStrings['voice'];
}) {
  const theme = useTheme();
  const action: VoiceAgentAction = card.action;
  const actionGroupId = 'groupId' in action ? action.groupId : '';

  // Minted once per card, so a retry after a failure reuses the same ids and
  // appends no duplicate (the same pattern the basic review uses).
  const [expenseId] = useState(() => randomUUID());
  const [newGroupId] = useState(() => randomUUID());
  const [newMemberId] = useState(() => randomUUID());

  const writeExpense = useWriteExpense(actionGroupId);
  const recordSettlement = useRecordSettlement(actionGroupId);
  const createGroup = useCreateGroup();
  const addGhost = useAddGhostMember(action.type === 'create_group' ? newGroupId : actionGroupId);
  const upsertPersonal = useUpsertPersonalRecord();

  const group = local.groups.find((candidate) => candidate.id === actionGroupId);

  const run = useCallback(async (): Promise<void> => {
    if (card.problem) return;
    onStatus('running');
    try {
      switch (action.type) {
        case 'add_expense': {
          const write = expenseWriteFromAction(action, group, expenseId, today);
          if (!write) throw new Error('expense does not hold together');
          await writeExpense.mutateAsync(write);
          break;
        }
        case 'add_personal': {
          const description = action.description.trim();
          await upsertPersonal.mutateAsync({
            recordId: expenseId,
            recordKind: 'txn',
            data: encodeTxn({
              kind: 'expense',
              amount: BigInt(action.amountMinor),
              currency: action.currency,
              category: action.category ?? guessCategory(description),
              note: description,
              date: action.date ?? today,
              loanId: null,
              recurringId: null,
            }),
          });
          break;
        }
        case 'record_settlement':
          await recordSettlement.mutateAsync({
            groupId: action.groupId,
            fromMemberId: action.fromMemberId,
            toMemberId: action.toMemberId,
            amount: BigInt(action.amountMinor),
            rail: 'cash',
            currency: action.currency,
          });
          break;
        case 'nudge':
          try {
            await nudgeToSettle({
              groupId: action.groupId,
              toMemberId: action.toMemberId,
              currency: action.currency,
            });
          } catch (caught) {
            // "Already reminded today" is a normal answer, not a failure.
            const message = caught instanceof Error ? caught.message : '';
            if (!/NUDGE_RATE_LIMIT/i.test(message)) throw caught;
          }
          break;
        case 'create_group':
          await createGroup.mutateAsync({
            groupId: newGroupId,
            creatorMemberId: newMemberId,
            name: action.name.trim(),
            type: (GROUP_TYPES.includes(action.groupType)
              ? action.groupType
              : GroupType.Other) as GroupType,
            currency: action.currency,
          });
          for (const name of action.memberNames) {
            if (name.trim()) await addGhost.mutateAsync(name.trim());
          }
          break;
        case 'add_member': {
          const exists = group?.members.some(
            (member) => member.name.trim().toLowerCase() === action.name.trim().toLowerCase(),
          );
          if (!exists) await addGhost.mutateAsync(action.name.trim());
          break;
        }
      }
      onStatus('done');
    } catch {
      onStatus('failed');
    }
    // The mutation hooks are stable per render; the action and ids are fixed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, group, today]);

  // "Confirm all" bumps the sequence; every card still waiting runs itself.
  const lastSeq = useRef(0);
  useEffect(() => {
    if (confirmAllSeq === lastSeq.current) return;
    lastSeq.current = confirmAllSeq;
    if (status === 'pending' && !card.problem) void run();
  }, [confirmAllSeq, status, card.problem, run]);

  // Edit hands the proposal to the ordinary form, prefilled — the same route
  // params the quick sheet uses — and the card is done with.
  const edit = (): void => {
    if (action.type === 'add_expense') {
      onStatus('discarded');
      router.push({
        pathname: '/group/[id]/add-expense',
        params: {
          id: action.groupId,
          amount: action.amountMinor,
          currency: action.currency,
          description: action.description,
          ...(action.category ? { category: action.category } : {}),
          ...(action.date ? { expenseDate: action.date } : {}),
          // Who paid and how it was split, so editing never quietly resets the
          // proposal to "I paid, split with everyone".
          ...encodeAgentSplitParams({ paidByMemberId: action.paidByMemberId, split: action.split }),
          quick: '1',
        },
      });
    } else if (action.type === 'add_personal') {
      onStatus('discarded');
      router.push({
        pathname: '/personal/entry',
        params: {
          amount: action.amountMinor,
          currency: action.currency,
          kind: 'expense',
          note: action.description,
        },
      });
    }
  };
  const editable = action.type === 'add_expense' || action.type === 'add_personal';

  const finished = status === 'done' || status === 'discarded';
  const [headline, ...rest] = card.segments;

  return (
    <View
      style={{
        gap: theme.spacing.sm,
        padding: theme.spacing.md,
        opacity: status === 'discarded' ? 0.45 : 1,
      }}
    >
      <Text variant="subheading">{headline}</Text>
      {rest.length > 0 ? (
        <Text variant="caption" tone="muted">
          {rest.join(' · ')}
        </Text>
      ) : null}
      {card.problem && !finished ? (
        <Text variant="caption" tone="negative">
          {text.agentProblem}
        </Text>
      ) : null}
      {status === 'failed' ? (
        <Text variant="caption" tone="negative">
          {text.agentCouldNotRun}
        </Text>
      ) : null}
      {status === 'done' ? (
        <Text variant="caption" tone="muted">
          {text.agentDone}
        </Text>
      ) : null}
      {finished ? null : (
        <Row gap={theme.spacing.sm}>
          <Button
            label={text.agentConfirm}
            size="sm"
            onPress={() => void run()}
            disabled={card.problem || status === 'running'}
          />
          {editable ? (
            <Button
              label={text.agentEdit}
              size="sm"
              variant="secondary"
              onPress={edit}
              disabled={status === 'running'}
            />
          ) : null}
          <Button
            label={text.agentDiscard}
            size="sm"
            variant="secondary"
            onPress={() => onStatus('discarded')}
            disabled={status === 'running'}
          />
        </Row>
      )}
    </View>
  );
}
