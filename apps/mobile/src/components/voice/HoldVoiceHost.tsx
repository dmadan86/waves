/**
 * Hold the bar's mic on any screen: a compact pill above the bar (red dot,
 * timer, the words as they come, "Slide to cancel") instead of the full voice
 * screen. Lifting sends; sliding away cancels and files nothing.
 *
 * On send the heard sentence is filed as a draft at once, then read by the same
 * pipeline the voice screen uses (agent when it is on, else the on-device
 * parser) and added by the same auto-add rule (`holdLanding` /
 * `agentAddsAtOnce`). A clear expense is added with a 6 s Undo; anything else
 * stays as the draft and says so. Commands that are not an expense (settle,
 * remind, balance questions) are handed to the voice screen unchanged.
 */

import { useEffect, useRef, useState, type ComponentType } from 'react';
import { randomUUID } from 'expo-crypto';
import { Platform, Pressable, View } from 'react-native';

import {
  format,
  guessCategory,
  minorUnitScale,
  money,
  MutationKind,
  computeShares,
  type SplitParams,
} from '@waves/core';
import { Text, useTheme } from '@waves/ui';

import { agentText, useAgentLocalData } from '@/components/VoiceAgentPanel';
import {
  useDeleteCapture,
  useCreateCapture,
  useExpenseGroups,
  useGroup,
  useVoiceAgentStatus,
} from '@/data/hooks';
import { useDeletePersonalRecord, useUpsertPersonalRecord } from '@/data/personal';
import { serialiseExpense } from '@/data/serialiseExpense';
import { displayName, GroupType, isViewer } from '@/data/types';
import { fill, plural, useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { useBottomClearance } from '@/lib/clearance';
import { useDefaultCurrency } from '@/lib/currency';
import { agentAddsAtOnce, formatHoldTime, holdLanding, holdSummary } from '@/lib/holdVoicePure';
import { router } from '@/lib/navigation';
import { useReducedMotion } from '@/lib/reducedMotion';
import { useAssistantAnswerer } from '@/lib/useAssistantAnswerer';
import { useVoiceStreamsToCloud } from '@/lib/useVoiceRouting';
import { transcriptRoute } from '@/lib/assistantComposerPure';
import { savedStateFrom, type SavedState } from '@/lib/followUpApply';
import { meterVoiceCommand, sendVoiceTranscript } from '@/lib/voiceAgent';
import {
  expenseWriteFromAction,
  personalWriteFromAction,
  planVoiceAgentActions,
  type AgentExpenseWrite,
} from '@/lib/voiceAgentPlan';
import { agentFailureOf } from '@/lib/voiceAgentPure';
import { useVoiceConsent } from '@/lib/voiceConsentStore';
import { voiceSaveCurrency } from '@/lib/voiceCurrency';
import { heardCaptureInput, worthFiling } from '@/lib/voiceDraftPure';
import {
  detectAddMember,
  detectBalanceQuery,
  detectMoneyIntent,
  parseVoiceExpenses,
  resolveVoiceParticipants,
  type VoiceParseResult,
} from '@/lib/voiceExpense';
import { isVoiceAssistantRequest } from '@/lib/voiceAssistantRequest';
import { localParseIsConfident, parseLocally, type FastPathContext } from '@/lib/voiceFastPath';
import { learnedForGroup, voiceNameHints, withAliases } from '@/lib/voiceNames';
import { useVoiceNameMemory } from '@/lib/voiceNameStore';
import { resolveVoiceSpace } from '@/lib/voiceSpace';
import { useOpenSpaces, useVoiceAdded, useVoiceDefaultSpace } from '@/lib/voiceSpaceStore';
import { useSync } from '@/sync';
import { UNDO_RING_MS } from '@/lib/assistantUndo';

import { formatVoiceDiag, VOICE_DIAG_ENABLED, type VoiceDiag } from '@/lib/voiceDiagPure';

import type { HoldRecorderProps } from './HoldRecorder';

type RecorderType = ComponentType<HoldRecorderProps>;

// Required inside a try, for the reason `VoiceMicPanel` gives.
const RecorderView: RecorderType | null = (() => {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('./HoldRecorder') as { HoldRecorder: RecorderType }).HoldRecorder;
  } catch {
    return null;
  }
})();

const EQUAL: SplitParams = { kind: 'equal' };
const today = (): string => new Date().toISOString().slice(0, 10);

function toMinor(amount: number, currency: string): bigint | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return BigInt(Math.round(amount * Number(minorUnitScale(currency))));
}

type Toast =
  | { kind: 'reading'; waiting: number }
  | { kind: 'added'; line: string; saved: SavedState[]; toReview?: boolean }
  | { kind: 'later'; draftId: string };

/** One read sentence, held until the queue drains. */
type HoldResult =
  { kind: 'added'; line: string; saved: SavedState } | { kind: 'later'; draftId: string };

export interface HoldVoiceHostProps {
  /** `down`: finger on the mic. `send`: lifted. `off`: nothing running. */
  mode: 'off' | 'down' | 'send';
  groupId: string | null;
  personal: boolean;
  /** The recorder has handed over its words (or failed): the hold is over. */
  onFinished: () => void;
}

export function HoldVoiceHost({ mode, groupId, personal, onFinished }: HoldVoiceHostProps) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const reduceMotion = useReducedMotion();
  const bottom = useBottomClearance();
  const viewerId = useViewerId();
  const dc = useDefaultCurrency();
  const { mutate } = useSync();
  const groups = useExpenseGroups();
  const local = useAgentLocalData(viewerId);
  const createCapture = useCreateCapture();
  const deleteCapture = useDeleteCapture();
  const upsertPersonal = useUpsertPersonalRecord();
  const deletePersonal = useDeletePersonalRecord();
  const voiceAdded = useVoiceAdded();
  const nameMemory = useVoiceNameMemory(viewerId);
  const answerer = useAssistantAnswerer();
  const { ids: spaceIds } = useOpenSpaces();
  const { defaultId } = useVoiceDefaultSpace();
  const { enabled: agentServerOn } = useVoiceAgentStatus();
  const consent = useVoiceConsent(viewerId);
  const streamsToCloud = useVoiceStreamsToCloud();

  // The same launch rules as the voice screen: the screen's group, else the default space.
  const launchPersonal = personal && !groupId;
  const launchGroupId = resolveVoiceSpace({
    launchId: groupId,
    defaultId: launchPersonal ? null : defaultId,
    memberIds: spaceIds,
  });
  const launchGroup = useGroup(launchGroupId ?? '');
  const launchMembers = launchGroupId
    ? withAliases(
        (launchGroup.members.data ?? []).map((member) => ({
          id: member.id,
          name: member.profile?.display_name ?? displayName(member, viewerId),
          isMe: isViewer(member, viewerId),
        })),
        nameMemory,
        launchGroupId,
      )
    : undefined;
  const groupRows = groups.data ?? [];
  const groupRefs = groupRows.map((g) => ({
    id: g.id,
    name: g.name,
    currency: g.default_currency,
  }));
  const agentOn = agentServerOn && consent.state === 'granted';

  // The words and the clock while the finger is down.
  const [words, setWords] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [diag, setDiag] = useState<VoiceDiag | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recording = mode !== 'off';

  useEffect(() => {
    if (!recording) return undefined;
    const start = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - start), 250);
    return () => {
      clearInterval(id);
      setWords('');
      setLevel(0);
      setElapsed(0);
    };
  }, [recording]);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const show = (next: Toast | null, ms = UNDO_RING_MS): void => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(next);
    if (next && next.kind !== 'reading') toastTimer.current = setTimeout(() => setToast(null), ms);
  };

  const launchParams = personal ? { scope: 'personal' } : groupId ? { group: groupId } : {};

  // Write one clear expense; null when it does not hold together.
  const addGroup = async (groupIdTo: string, write: AgentExpenseWrite): Promise<void> => {
    await mutate(MutationKind.ExpenseCreate, groupIdTo, {
      ...serialiseExpense(write),
      expenseId: write.expenseId,
    });
    voiceAdded.mark(groupIdTo, [write.expenseId]);
  };

  const isCompany = (id: string): boolean =>
    groupRows.find((g) => g.id === id)?.type === GroupType.Company;

  const readAndAdd = async (
    transcript: string,
    alternatives: readonly string[],
  ): Promise<SavedState | null> => {
    const date = today();
    const id = randomUUID();

    const basic = async (): Promise<SavedState | null> => {
      const parsed: VoiceParseResult = parseVoiceExpenses(transcript, groupRefs, {
        members: launchMembers,
        currentGroupId: launchGroupId,
        alternatives,
        learned: learnedForGroup(nameMemory, launchGroupId),
      });
      const landing = holdLanding(parsed, { launchGroupId, launchPersonal }, spaceIds);
      const item = parsed.items[0];
      if (landing.kind === 'later' || !item) return null;
      const note = item.note.trim() || t.voice.anExpense;
      if (landing.kind === 'personal') {
        const currency = item.currency ?? dc;
        const amount = toMinor(item.amountMajor, currency);
        if (amount === null) return null;
        const action = {
          type: 'add_personal' as const,
          description: note,
          amountMinor: amount.toString(),
          currency,
          category: item.category ?? null,
          date,
        };
        await upsertPersonal.mutateAsync(personalWriteFromAction(action as never, id, date));
        return savedStateFrom(action as never, null, id, date);
      }
      if (isCompany(landing.groupId)) return null;
      const group = local.groups.find((g) => g.id === landing.groupId);
      const me = group?.members.find((m) => m.isViewer);
      if (!group || !me) return null;
      const currency = voiceSaveCurrency(item.currency, group.currency, dc);
      const amount = toMinor(item.amountMajor, currency);
      if (amount === null) return null;
      const participants = resolveVoiceParticipants({
        all: group.members.map((m) => m.id),
        payer: me.id,
        members: group.members.map((m) => ({ id: m.id, name: m.name })),
        peopleText: null,
        splitCount: null,
      });
      if (participants.length === 0) return null;
      const category = item.category ?? guessCategory(note);
      const write: AgentExpenseWrite = {
        expenseId: id,
        description: note,
        category,
        expenseDate: date,
        currency,
        amount,
        splitParams: EQUAL,
        participants: [...participants],
        payers: { [me.id]: amount },
        expectedShares: Object.fromEntries(
          computeShares({ amount, currency, params: EQUAL, participants, seed: id }),
        ),
      };
      await addGroup(landing.groupId, write);
      return savedStateFrom(
        {
          type: 'add_expense',
          groupId: landing.groupId,
          description: note,
          amountMinor: amount.toString(),
          currency,
          category,
          date,
        } as never,
        write,
        id,
        date,
      );
    };

    if (agentOn) {
      const fastContext: FastPathContext = {
        groups: groupRefs,
        currentGroupId: launchGroupId,
        membersByGroup: launchGroupId && launchMembers ? { [launchGroupId]: launchMembers } : {},
        alternatives,
        learnedByGroup: launchGroupId
          ? { [launchGroupId]: learnedForGroup(nameMemory, launchGroupId) }
          : {},
      };
      // The phone heard it, so the agent is asked for any agent-on reader, as
      // for Free on the voice screen; a confident local read skips it.
      const route = transcriptRoute({
        agentOn,
        streamed: false,
        phoneToAgent: true,
        typed: false,
        appending: false,
        heardFromLink: false,
        answeringAgent: false,
        localConfident: () =>
          localParseIsConfident(parseLocally(transcript, fastContext), fastContext),
      });
      if (route === 'fast') {
        // Pro would have streamed (and so counted) this sentence; keep the count.
        if (streamsToCloud) void meterVoiceCommand({ transcript, locale, today: date });
        return basic();
      }
      if (route === 'agent') {
        const result = await sendVoiceTranscript({
          transcript,
          groupId: launchGroupId,
          personal: launchPersonal,
          locale,
          today: date,
        });
        // Quota, offline, a bad reply: carry on with the phone's own read, quietly.
        if (result.kind !== 'ok') {
          void agentFailureOf(result);
          return basic();
        }
        const plan = planVoiceAgentActions(result.response, local, agentText(t));
        const card = plan.cards[0];
        if (!card || !agentAddsAtOnce(plan)) return null;
        const action = card.action;
        if (action.type === 'add_personal') {
          await upsertPersonal.mutateAsync(personalWriteFromAction(action, id, date));
          return savedStateFrom(action, null, id, date);
        }
        if (action.type !== 'add_expense' || isCompany(action.groupId)) return null;
        const write = expenseWriteFromAction(
          action,
          local.groups.find((g) => g.id === action.groupId),
          id,
          date,
        );
        if (!write) return null;
        await addGroup(action.groupId, write);
        return savedStateFrom(action, write, id, date);
      }
    }
    return basic();
  };

  const readOne = async (
    heard: string,
    alternatives: readonly string[],
  ): Promise<HoldResult | null> => {
    const transcript = heard.trim();
    if (!worthFiling(transcript)) return null;
    // Not an expense: the voice screen handles settle, remind and questions.
    if (
      detectMoneyIntent(transcript) ||
      detectBalanceQuery(transcript) ||
      detectAddMember(transcript) ||
      isVoiceAssistantRequest(transcript) ||
      answerer.parse(transcript)
    ) {
      router.push({
        pathname: '/voice',
        params: { ...launchParams, heard: transcript, hn: randomUUID() },
      });
      return null;
    }
    // Never lost: the sentence is a draft before anything is understood.
    const draftId = randomUUID();
    const filing = createCapture
      .mutateAsync({ captureId: draftId, ...heardCaptureInput(transcript, today(), dc) })
      .then(
        () => true,
        () => false,
      );
    let saved: SavedState | null = null;
    try {
      saved = await readAndAdd(transcript, alternatives);
    } catch {
      saved = null;
    }
    if (!saved) return { kind: 'later', draftId };
    // The add stands in for the draft; delete it only once its create has landed.
    void filing
      .then((ok) => (ok ? deleteCapture.mutateAsync(draftId) : undefined))
      .catch(() => undefined);
    const where =
      saved.kind === 'personal'
        ? t.voiceScreen.justYou
        : (local.groups.find((g) => g.id === saved?.groupId)?.name ?? '');
    return {
      kind: 'added',
      saved,
      line: fill(t.voice.holdAdded, {
        amount: format(money(saved.amount, saved.currency), { locale }),
        where,
      }),
    };
  };

  // Holds queue: the mic is never blocked while a sentence is read. Each one is
  // read in turn, and the pill sums the run once the last is done.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const waiting = useRef(0);
  const batch = useRef<HoldResult[]>([]);
  const run = (heard: string, alternatives: readonly string[]): void => {
    waiting.current += 1;
    show({ kind: 'reading', waiting: waiting.current });
    queue.current = queue.current.then(async () => {
      try {
        const result = await readOne(heard, alternatives);
        if (result) batch.current.push(result);
      } catch {
        // readOne files a draft first; a throw here leaves nothing to report.
      }
      waiting.current -= 1;
      if (waiting.current > 0) {
        show({ kind: 'reading', waiting: waiting.current });
        return;
      }
      const results = batch.current;
      batch.current = [];
      const added = results.flatMap((r) => (r.kind === 'added' ? [r] : []));
      const later = results.length - added.length;
      const summary = holdSummary(added.length, later);
      if (summary.kind === 'none') show(null);
      else if (summary.kind === 'one-added' && added[0])
        show({ kind: 'added', line: added[0].line, saved: [added[0].saved] });
      else if (summary.kind === 'one-later' && results[0]?.kind === 'later')
        show({ kind: 'later', draftId: results[0].draftId });
      else if (summary.kind === 'many') {
        const parts = [];
        if (summary.added > 0) parts.push(plural(locale, summary.added, t.voice.holdAddedMany));
        if (summary.later > 0) parts.push(plural(locale, summary.later, t.voice.holdInReview));
        show({
          kind: 'added',
          line: parts.join(' · '),
          saved: added.map((r) => r.saved),
          toReview: summary.later > 0,
        });
      }
    });
  };

  const undo = async (all: readonly SavedState[]): Promise<void> => {
    try {
      for (const saved of all) {
        if (saved.kind === 'personal') await deletePersonal.mutateAsync(saved.id);
        else if (saved.groupId)
          await mutate(MutationKind.ExpenseDelete, saved.groupId, { expenseId: saved.id });
        voiceAdded.forget(saved.id);
      }
      show(null);
    } catch {
      // Still added: keep the toast, and Undo, for another try. No error copy.
      show(toast);
    }
  };

  const open = (current: Toast): void => {
    show(null);
    if (current.kind === 'later')
      router.push({ pathname: '/capture', params: { editId: current.draftId } });
    else if (current.kind === 'added' && (current.toReview || current.saved.length !== 1))
      router.push('/captures' as never);
    else if (current.kind === 'added' && current.saved[0]) {
      const s = current.saved[0];
      if (s.kind === 'personal') router.push({ pathname: '/personal/entry', params: { id: s.id } });
      else if (s.groupId) router.push(`/group/${s.groupId}/expense/${s.id}` as never);
    }
  };

  const hints = launchMembers ? voiceNameHints(launchMembers) : undefined;

  return (
    <>
      {recording && RecorderView ? (
        <RecorderView
          finish={mode === 'send'}
          hints={hints}
          // Cloud speech-to-text for everyone the server allows; only the agent is Pro.
          cloud={
            agentOn
              ? {
                  groupId: launchGroupId,
                  personal: launchPersonal,
                  today: today(),
                  batch: streamsToCloud,
                }
              : null
          }
          onWords={setWords}
          onLevel={setLevel}
          onDiag={setDiag}
          onDone={(heard, alternatives) => {
            onFinished();
            run(heard, alternatives);
          }}
        />
      ) : null}
      {recording ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.25)',
          }}
        />
      ) : null}
      {recording || toast ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom,
            paddingHorizontal: theme.spacing.xl,
          }}
        >
          {VOICE_DIAG_ENABLED && diag ? (
            <Text variant="micro" tone="muted" numberOfLines={1} style={{ textAlign: 'center' }}>
              {formatVoiceDiag(diag)}
            </Text>
          ) : null}
          <View
            accessibilityLiveRegion="polite"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.sm,
              minHeight: 48,
              paddingHorizontal: theme.spacing.lg,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.color.surface,
              shadowColor: '#000',
              shadowOpacity: 0.18,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 4 },
              elevation: 8,
            }}
          >
            {recording ? (
              <>
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: theme.color.negative,
                    opacity: reduceMotion ? 1 : elapsed % 1000 < 500 ? 1 : 0.4,
                    // Swells with the voice: proof the mic is hearing, before any word.
                    transform: [{ scale: 1 + level * 1.2 }],
                  }}
                />
                <Text variant="micro" style={{ fontWeight: '700' }}>
                  {formatHoldTime(elapsed)}
                </Text>
                <Text variant="micro" numberOfLines={1} style={{ flex: 1 }}>
                  {words}
                </Text>
                <Text variant="micro" tone="muted" numberOfLines={1}>
                  {`‹ ${t.voice.slideToCancel}`}
                </Text>
              </>
            ) : toast?.kind === 'reading' ? (
              <Text variant="micro" tone="muted" style={{ flex: 1 }}>
                {toast.waiting > 1
                  ? fill(t.voice.holdReadingMany, { count: String(toast.waiting) })
                  : t.voice.holdReading}
              </Text>
            ) : toast ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => open(toast)}
                  style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}
                >
                  <Text variant="micro" numberOfLines={1}>
                    {toast.kind === 'added' ? toast.line : t.voiceScreen.unclearTitle}
                  </Text>
                </Pressable>
                {toast.kind === 'added' && toast.saved.length > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.voice.autoUndo}
                    onPress={() => void undo(toast.saved)}
                    style={{ minHeight: 44, justifyContent: 'center' }}
                  >
                    <Text variant="micro" tone="brand" style={{ fontWeight: '700' }}>
                      {t.voice.autoUndo}
                    </Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}
          </View>
        </View>
      ) : null}
    </>
  );
}
