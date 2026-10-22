/**
 * The advanced voice flow (Pro, behind the `voice_agent` flag): the sentence the mic
 * just streamed goes to the `voice-agent` function, and what comes back is shown
 * as one plain list (one row per proposed action, tap to fix, ✕ to drop) — nothing
 * is written until a person taps the screen's one Add button. Each added action
 * runs through the same hooks the rest of the app writes with, so the offline
 * queue and sync behave as everywhere else.
 *
 * If the agent cannot be reached or the allowance is spent, the panel hands the
 * transcript back to the screen (`onFallback`), which carries on with
 * the basic path exactly as it does without the flag.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { randomUUID } from 'expo-crypto';
import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import { materialiseGroups, materialiseMembers, type VoiceAgentAction } from '@waves/core';
import { sanitiseMinorInput } from '@waves/core';
import { Card, Divider, IconButton, iconSize, Text, useTheme } from '@waves/ui';

import { DraftRow } from '@/components/voice/DraftRow';
import { useReportFooter, type FooterSpec } from '@/components/voice/VoiceFooter';

import { AssistantMoneyAnswer } from '@/components/AssistantAnswerCard';
import { VoiceClarifyCard } from '@/components/VoiceClarifyCard';
import { VoiceTypedAnswer } from '@/components/VoiceTypedAnswer';
import { VoiceConfirmCard } from '@/components/VoiceConfirmCard';
import { AssistantSavedBar, type SavedBarEvent } from '@/components/AssistantSavedBar';
import { VoiceFollowUps } from '@/components/VoiceFollowUps';

import { nudgeToSettle } from '@/data/api';
import {
  useAddGhostMember,
  useCreateGroup,
  useRecordSettlement,
  useWriteExpense,
} from '@/data/hooks';
import { useUpsertPersonalRecord } from '@/data/personal';
import { GroupType, isViewer, type GroupRow, type MemberRow } from '@/data/types';
import { useStrings, type UiStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { sendVoiceTranscript } from '@/lib/voiceAgent';
import type { AgentStage } from '@/lib/voiceFlowPure';
import { followUpsAllowed } from '@/lib/assistantCorrections';
import type { UndoEntry } from '@/lib/assistantUndo';
import { savedStateFrom, type SavedState } from '@/lib/followUpApply';
import { agentFailureOf } from '@/lib/voiceAgentPure';
import { clarifyOptionViews, otherGroupChoices, typedFollowUp } from '@/lib/voiceClarifyPure';
import type { ConfirmableAction } from '@/lib/voiceConfirmPure';
import {
  editedAction,
  listFooter,
  rowEditFrom,
  type CardStatus,
  type RowEdit,
} from '@/lib/voiceAgentListPure';
import type { AgentFailure } from '@/lib/voiceEnginePure';
import {
  expenseWriteFromAction,
  personalWriteFromAction,
  planVoiceAgentActions,
  type AgentCard,
  type AgentLocalData,
  type AgentLocalGroup,
  type AgentExpenseWrite,
  type AgentPlan,
  type VoiceAgentText,
} from '@/lib/voiceAgentPlan';
import { useToast } from '@/lib/toast';
import { useAssistantAnswerer } from '@/lib/useAssistantAnswerer';
import { useSync } from '@/sync';

export type AgentFallbackReason = AgentFailure;

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
  /** A tapped option answers the question: send `answer` as the reply. */
  onAnswer: (followUp: { transcript: string; question: string }, answer: string) => void;
  /** This clip answers the agent's earlier question. */
  followUp?: { transcript: string; question: string } | null;
  /** Everything is confirmed or discarded; Done leaves the screen. */
  onClose: () => void;
  /** Speak another command on this same screen, after a save. */
  onAddAnother?: () => void;
  /**
   * What the person sees after a single expense is saved, in place of the
   * follow-up questions. The screen passes this for a Free account (the Pro
   * teaser); omitted, the follow-ups run as before.
   */
  renderAfterSave?: (saved: SavedState) => ReactNode;
  /** One command has ended: how, and whether it was a personal or a group expense. */
  onResolved?: (outcome: 'confirmed' | 'discarded', scope: 'personal' | 'group') => void;
  /** A correction or undo on the saved bar, for telemetry. */
  onSavedBarEvent?: (event: SavedBarEvent) => void;
  /** Where the panel is (reading, proposal, question, saved), for the stage above it. */
  onStage?: (stage: AgentStage) => void;
  /** The screen's footer button for this panel: Add, or Done and Add another. */
  onFooter?: (spec: FooterSpec | null) => void;
}

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
    noRateYet: t.fx.noRateYet,
  };
}

/** The reader's groups and who is in them, read from the local mirror. */
export function useAgentLocalData(viewerId: string | null): AgentLocalData {
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
        convertsToGroupCurrency: group.convert_to_group_currency === true,
        photoPath: group.photo_path,
        coverEmoji: group.cover_emoji,
        units: group.units,
        members: members.map((member) => ({
          id: member.id,
          name: member.profile?.display_name ?? member.ghost_name ?? '',
          isViewer: isViewer(member, viewerId),
          avatarUrl: member.profile?.avatar_url ?? null,
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
  onAnswer,
  followUp,
  onClose,
  renderAfterSave,
  onAddAnother,
  onResolved,
  onSavedBarEvent,
  onStage,
  onFooter,
}: VoiceAgentPanelProps) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const viewerId = useViewerId();
  const local = useAgentLocalData(viewerId);
  const answerer = useAssistantAnswerer();
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
      else fallbackRef.current(agentFailureOf(result));
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
  // Set once the single confirmed expense is saved: the follow-up questions take over.
  const [savedFollowUp, setSavedFollowUp] = useState<{
    state: SavedState;
    write: AgentExpenseWrite | null;
  } | null>(null);

  // A hand-off the follow-ups did (a lend, a duplicate removed), so the bar can undo it.
  const [handoff, setHandoff] = useState<UndoEntry | null>(null);

  const toast = useToast();
  const rows = (plan?.cards ?? []).map((card) => ({
    problem: card.problem,
    status: statusOf(card.key),
  }));
  const footer = listFooter(rows);
  const anyDone = rows.some((row) => row.status === 'done');
  // One proposed expense and nothing else: the confirmation card, with its fields
  // editable in place. Anything more (several actions, a settle-up, an answer or
  // a question) is the list below.
  const first =
    plan && !plan.answer && !plan.clarify && followUpsAllowed(plan.cards)
      ? plan.cards[0]
      : undefined;
  const solo = first && confirmable(first.action) ? first.action : null;

  // Tell the screen where this panel is, so the stage above it (mic, status line,
  // transcript) says the same thing without being rebuilt.
  const stage: AgentStage = !plan
    ? 'working'
    : savedFollowUp || (footer.kind === 'done' && anyDone)
      ? 'saved'
      : plan.clarify
        ? 'question'
        : 'ready';
  const stageRef = useRef(onStage);
  useEffect(() => {
    stageRef.current = onStage;
  });
  useEffect(() => {
    stageRef.current?.(stage);
  }, [stage]);

  // The one action under the panel. The confirmation card reports its own Add;
  // otherwise it is Add / Add all for the list, then Done and Add another.
  const finish = (): void => {
    if (anyDone) toast.show(t.voice.agentDone);
    onResolved?.(anyDone ? 'confirmed' : 'discarded', 'group');
    onClose();
  };
  const another = (resolved: boolean): FooterSpec['secondary'] =>
    onAddAnother
      ? {
          label: t.voiceScreen.addAnother,
          onPress: () => {
            if (resolved) onResolved?.('confirmed', 'group');
            onAddAnother();
          },
        }
      : undefined;
  const spec: FooterSpec = savedFollowUp
    ? { primary: { label: t.voiceScreen.done, onPress: onClose }, secondary: another(false) }
    : plan?.clarify || solo
      ? {}
      : footer.kind === 'add'
        ? {
            primary: {
              label: footer.count > 1 ? t.voiceScreen.addAll : t.voiceScreen.addExpense,
              disabled: footer.disabled,
              onPress: () => setConfirmAllSeq((current) => current + 1),
            },
          }
        : footer.kind === 'done'
          ? {
              primary: { label: t.voiceScreen.done, onPress: finish },
              secondary: footer.addAnother ? another(true) : undefined,
            }
          : {};
  useReportFooter(solo && !savedFollowUp ? undefined : onFooter, spec);

  // The stage above already says "Understanding…" with its busy mic: no second wait.
  if (!plan) return null;

  const nothing = plan.cards.length === 0 && !plan.answer && !plan.clarify;
  // A question about the person's own spend is answered here from the ledger,
  // whatever the server said: it cannot see the personal ledger at all.
  const moneyQuery = plan.cards.length === 0 ? answerer.parse(plan.transcript || transcript) : null;

  if (solo && first) {
    if (savedFollowUp) {
      return renderAfterSave ? (
        renderAfterSave(savedFollowUp.state)
      ) : (
        <VoiceFollowUps
          initial={savedFollowUp.state}
          groupWrite={savedFollowUp.write}
          local={local}
          today={today}
          onClose={onClose}
          onUndoable={setHandoff}
          renderSavedBar={(bar) => (
            <AssistantSavedBar
              context={bar}
              controls={bar.controls}
              groupWrite={savedFollowUp.write}
              local={local}
              today={today}
              externalEntry={handoff}
              onEvent={onSavedBarEvent}
            />
          )}
        />
      );
    }
    return (
      <ConfirmExpense
        action={solo}
        transcript={plan.transcript || transcript}
        local={local}
        today={today}
        onFooter={onFooter}
        onAdded={(saved) => {
          setCardStatus(first.key, 'done');
          onResolved?.('confirmed', solo.type === 'add_personal' ? 'personal' : 'group');
          // Pro-only by construction: this panel exists only where the agent does.
          setSavedFollowUp(saved);
        }}
      />
    );
  }

  return (
    <View style={{ gap: theme.spacing.md }}>
      {moneyQuery ? (
        <AssistantMoneyAnswer query={moneyQuery} onNavigate={onClose} />
      ) : plan.clarify && clarifyOptionViews(plan.clarifyOptions).length > 0 ? (
        <VoiceClarifyCard
          question={plan.clarify}
          options={plan.clarifyOptions}
          moreChoices={otherGroupChoices(
            clarifyOptionViews(plan.clarifyOptions),
            local.groups.map((group) => ({
              name: group.name,
              // Who else is in it, so two groups with similar names tell apart.
              detail: group.members
                .filter((member) => !member.isViewer && member.name)
                .map((member) => member.name)
                .slice(0, 3)
                .join(', '),
            })),
          )}
          onPick={(answer) =>
            onAnswer(
              { transcript: plan.transcript || transcript, question: plan.clarify ?? '' },
              answer,
            )
          }
        />
      ) : plan.clarify || nothing ? (
        <Card>
          <View style={{ gap: theme.spacing.sm }}>
            <Text accessibilityRole="header" style={{ fontWeight: '700' }}>
              {plan.clarify ?? t.voice.agentNothingToDo}
            </Text>
            {plan.clarify ? (
              <VoiceTypedAnswer
                autoFocus={false}
                onSubmit={(typed) => {
                  const follow = typedFollowUp(
                    typed,
                    plan.transcript || transcript,
                    plan.clarify ?? '',
                  );
                  if (follow) {
                    const { answer, ...followUp } = follow;
                    onAnswer(followUp, answer);
                  }
                }}
                onVoice={() =>
                  onRetry({
                    transcript: plan.transcript || transcript,
                    question: plan.clarify ?? '',
                  })
                }
              />
            ) : null}
          </View>
        </Card>
      ) : plan.answer ? (
        <Card>
          <Text variant="subheading">{plan.answer}</Text>
        </Card>
      ) : null}

      {/* A question open means nothing else is shown until it is answered. */}
      {!plan.clarify && plan.cards.some((card) => statusOf(card.key) !== 'discarded') ? (
        <Card padded={false} style={{ overflow: 'hidden' }}>
          {plan.cards
            .filter((card) => statusOf(card.key) !== 'discarded')
            .map((card, index) => (
              <View key={card.key}>
                {index > 0 ? <Divider /> : null}
                <AgentRow
                  card={card}
                  local={local}
                  today={today}
                  status={statusOf(card.key)}
                  onStatus={(next) => setCardStatus(card.key, next)}
                  confirmAllSeq={confirmAllSeq}
                />
              </View>
            ))}
        </Card>
      ) : null}
    </View>
  );
}

function confirmable(action: VoiceAgentAction): action is ConfirmableAction {
  return action.type === 'add_expense' || action.type === 'add_personal';
}

/** Writes the confirmed expense, the same way the list's Add does. */
function ConfirmExpense({
  action,
  transcript,
  local,
  today,
  onAdded,
  onFooter,
}: {
  action: ConfirmableAction;
  transcript: string;
  local: AgentLocalData;
  today: string;
  onAdded: (saved: { state: SavedState; write: AgentExpenseWrite | null }) => void;
  onFooter?: (spec: FooterSpec | null) => void;
}) {
  // Minted once, so a retry after a failure reuses the id and appends no duplicate.
  const [expenseId] = useState(() => randomUUID());
  const [groupId, setGroupId] = useState(action.type === 'add_expense' ? action.groupId : '');
  const writeExpense = useWriteExpense(groupId);
  const upsertPersonal = useUpsertPersonalRecord();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const add = async (resolved: ConfirmableAction): Promise<void> => {
    setBusy(true);
    setFailed(false);
    try {
      let groupWrite: AgentExpenseWrite | null = null;
      if (resolved.type === 'add_personal') {
        await upsertPersonal.mutateAsync(personalWriteFromAction(resolved, expenseId, today));
      } else {
        const group = local.groups.find((candidate) => candidate.id === resolved.groupId);
        const write = expenseWriteFromAction(resolved, group, expenseId, today);
        if (!write) throw new Error('expense does not hold together');
        await writeExpense.mutateAsync(write);
        groupWrite = write;
      }
      onAdded({ state: savedStateFrom(resolved, groupWrite, expenseId, today), write: groupWrite });
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <VoiceConfirmCard
      action={action}
      transcript={transcript}
      local={local}
      busy={busy}
      failed={failed}
      onGroupChange={(next) => setGroupId(next ?? '')}
      onAdd={(resolved) => void add(resolved)}
      onFooter={onFooter}
    />
  );
}

/**
 * One proposed action as a plain row: "₹8,000 · Groceries" for an expense (tap to
 * fix the amount or words, ✕ to drop it), the one-line summary for anything else.
 * It writes itself when the list's Add button bumps `confirmAllSeq`.
 */
function AgentRow({
  card,
  local,
  today,
  status,
  onStatus,
  confirmAllSeq,
}: {
  card: AgentCard;
  local: AgentLocalData;
  today: string;
  status: CardStatus;
  onStatus: (next: CardStatus) => void;
  confirmAllSeq: number;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const youLabel = t.voice.agentYou;

  // The amount and words a person has fixed in place; null until they touch the row.
  const [edit, setEdit] = useState<RowEdit | null>(null);
  const proposed = card.action;
  const expense = confirmable(proposed) ? proposed : null;
  const value = edit ?? (expense ? rowEditFrom(expense, local, youLabel) : null);
  const edited =
    expense && edit ? editedAction(expense, local, youLabel, t.voice.anExpense, edit) : null;
  const invalid = expense !== null && edit !== null && edited === null;
  const action: VoiceAgentAction = edited ?? proposed;
  const actionGroupId = 'groupId' in action ? action.groupId : '';

  // Minted once per row, so a retry after a failure reuses the same ids and
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

  const run = async (): Promise<void> => {
    if (card.problem || invalid) return;
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
          await upsertPersonal.mutateAsync(personalWriteFromAction(action, expenseId, today));
          break;
        }
        case 'record_settlement':
          // The plan marks a rate-less settle as a problem; this is the floor.
          if (group?.convertsToGroupCurrency && action.currency !== group.currency) {
            throw new Error('no rate yet');
          }
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
  };
  // The list's Add bumps the sequence; every row still waiting (or that failed) runs itself.
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  const lastSeq = useRef(0);
  useEffect(() => {
    if (confirmAllSeq === lastSeq.current) return;
    lastSeq.current = confirmAllSeq;
    if (status === 'pending' || status === 'failed') void runRef.current();
  }, [confirmAllSeq, status]);

  const done = status === 'done';
  const busy = status === 'running';
  const caption = card.problem
    ? { text: t.voice.agentProblem, negative: true }
    : invalid
      ? { text: t.voice.confirmNeedAmount, negative: true }
      : status === 'failed'
        ? { text: t.voice.agentCouldNotRun, negative: true }
        : null;

  if (expense && value) {
    return (
      <DraftRow
        draft={{
          key: card.key,
          amount: value.amountText,
          note: value.description,
          category: (edited ?? expense).category ?? null,
        }}
        currency={expense.currency}
        locale={locale}
        locked={done || busy}
        onEdit={(_key, patch) =>
          setEdit({
            amountText:
              patch.amount !== undefined
                ? sanitiseMinorInput(patch.amount, expense.currency)
                : value.amountText,
            description: patch.note ?? value.description,
          })
        }
        onRemove={() => onStatus('discarded')}
        fallbackNote={t.voice.anExpense}
        editLabel={t.common.edit}
        removeLabel={t.captures.delete}
        amountLabel={t.captures.amount}
        noteLabel={t.captures.description}
        notePlaceholder={t.captures.descriptionPlaceholder}
        caption={caption}
      />
    );
  }

  const [headline, ...rest] = card.segments;
  return (
    <View style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center' }}>
      <View style={{ flex: 1, gap: 2, padding: theme.spacing.md }}>
        <Text style={{ fontWeight: '600' }}>{headline}</Text>
        {rest.length > 0 ? (
          <Text variant="caption" tone="muted">
            {rest.join(' · ')}
          </Text>
        ) : null}
        {caption ? (
          <Text variant="caption" tone="negative">
            {caption.text}
          </Text>
        ) : null}
      </View>
      {done ? (
        <View style={{ padding: theme.spacing.md }}>
          <Ionicons name="checkmark-circle" size={iconSize.md} color={theme.color.brand} />
        </View>
      ) : busy ? null : (
        <IconButton label={t.captures.delete} onPress={() => onStatus('discarded')}>
          <Ionicons name="close" size={iconSize.md} color={theme.color.textFaint} />
        </IconButton>
      )}
    </View>
  );
}
