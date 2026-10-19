/**
 * After the advanced voice agent saves an expense, a short, optional chain of
 * follow-up questions that enrich it, in the same panel: "Added ₹8,000 to
 * Personal ✓ — Where was this?" with one-tap answers.
 *
 * What to ask, and when to stop, is decided in core (`followUps.ts`): a
 * deterministic scorer, at most two questions, one at a time, none for small
 * spends, none for what is already filled, and it stops after two skips in a
 * row. This component only renders the question the scorer picks and writes the
 * answer through the same hooks the rest of the app writes with. It only ever
 * mounts inside `VoiceAgentPanel`, so it exists exactly where the agent does.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { randomUUID } from 'expo-crypto';
import { Pressable, View } from 'react-native';

import {
  Frequency,
  advanceSession,
  dedupeFilled,
  cleanCounterpart,
  encodeLoan,
  deterministicId,
  encodeRecurring,
  format,
  markWrapUpShown,
  materialiseExpenses,
  materialiseGroups,
  materialiseMembers,
  money,
  MutationKind,
  nextFollowUp,
  nextMonthlyDate,
  recordAnswer,
  recordSkip,
  scheduleFor,
  NEW_SESSION,
  type FilledKind,
  type VoiceAgentResponse,
  type FollowUpEnvironment,
  type FollowUpKind,
  type FollowUpQuestion,
  type FollowUpSession,
  type PersonalLoan,
} from '@waves/core';
import { iconSize, Text, useTheme } from '@waves/ui';

import { InlineLoanShare } from '@/components/assistant/inline/InlineLoanShare';
import { InlineReceiptStatus } from '@/components/assistant/inline/InlineReceiptStatus';
import {
  InlineSheetHost,
  type InlineSheetRequest,
} from '@/components/assistant/inline/InlineSheetHost';
import { InlineSettle } from '@/components/assistant/inline/InlineSettle';
import { useInlineReceipt } from '@/components/assistant/inline/useInlineReceipt';
import { VoiceTypedAnswer } from '@/components/VoiceTypedAnswer';
import { SavedSummary, TextAction } from '@/components/voice/SavedSummary';
import {
  applyAgentResponse,
  applyCorrectionFields,
  changedFields,
  correctionLine,
  readLocally,
  type MovePlan,
  type TypedResult,
} from '@/lib/assistantCorrections';
import { hapticSelect } from '@/lib/assistantHaptics';
import {
  itemizeDraftFor,
  lentLoan,
  planAttendance,
  planItemize,
  planSplitMove,
  runOnce,
  type Claims,
} from '@/lib/assistantInline';
import { runMove, type MoveProgress } from '@/lib/assistantMove';
import { UNDO_RING_MS, type UndoEntry } from '@/lib/assistantUndo';
import { useCreateGroupRecurring } from '@/data/groupRecurring';
import { serialiseExpense } from '@/data/serialiseExpense';
import { useDeleteExpense, useOpenReceipts, useWriteExpense } from '@/data/hooks';
import {
  usePersonalLedger,
  useDeletePersonalRecord,
  useUpsertPersonalRecord,
} from '@/data/personal';
import { isViewer, type ExpenseRow, type GroupRow, type MemberRow } from '@/data/types';
import { fill, useStrings, type UiStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import {
  applyAnswer,
  chipLabel,
  deviceCurrencyFor,
  factsFor,
  filledBy,
  groupRecurringFor,
  paymentChoices,
  planUpdate,
  toGroupWrite,
  toPersonalData,
  visibleChips,
  type FollowUpAnswer,
  type SavedState,
} from '@/lib/followUpApply';
import {
  buildFollowUpHistory,
  type FollowUpHistory,
  type HistoryGroup,
} from '@/lib/followUpHistory';
import { useFollowUpPrefs } from '@/lib/followUpPrefs';
import { currentPlaceIfGranted } from '@/lib/location';
import { useToast } from '@/lib/toast';
import { useVoiceReply } from '@/lib/useVoiceReply';
import { sendVoiceTranscript } from '@/lib/voiceAgent';
import { checkOnline } from '@/lib/voiceStream';
import type { AgentExpenseWrite, AgentLocalData } from '@/lib/voiceAgentPlan';
import { FOLLOW_UP_TURN_CAP, matchChip } from '@/lib/voiceReplyPure';
import { findSplittableReceipt } from '@/lib/splitByItem';
import { useSync } from '@/sync';

export interface VoiceFollowUpsProps {
  initial: SavedState;
  /** The group write the expense was saved with; null for a personal one. */
  groupWrite: AgentExpenseWrite | null;
  local: AgentLocalData;
  today: string;
  onClose: () => void;
  /**
   * An answer was taken: typed or spoken, and whether a chip matched on the
   * phone or the model was asked. Optional; nothing is emitted without it.
   */
  onAnswerSource?: (source: 'typed' | 'voice', via: 'chip' | 'model') => void;
  /** Called with the new state each time an answer is written, so a parent
   *  (e.g. an undo bar) can follow the expense without editing this file. */
  onSavedStateChange?: (state: SavedState) => void;
  /** Rendered in place of the "Added ... ✓" line, e.g. an undo bar. */
  renderSavedBar?: (context: SavedBarContext) => ReactNode;
  /** A hand-off that moved the expense elsewhere (a lend, a duplicate removed), so it can be undone. */
  onUndoable?: (entry: UndoEntry) => void;
}

/** What a saved bar may do to the expense being followed. */
export interface SavedBarControls {
  /** Hold this state as the saved expense (after a correction, an undo or a move). */
  replaceSaved(next: SavedState): void;
  /** Add to the closing line's "Saved with ..." items. */
  addFilled(kinds: readonly FilledKind[]): void;
  /** Drop the newest closing-line item (an answer was undone). */
  popFilled(): void;
  /** Ask nothing more about this expense. */
  stop(): void;
  /** The person is working on it: do not close the panel by itself. */
  hold(): void;
  /**
   * The bar offers the executor that applies an agent reply to the expense (the
   * one typed corrections use), so an answer typed in the follow-up composer gets
   * the same amount, date, move, delete and undo history. Returns a way to drop it.
   */
  registerExecutor(run: (response: VoiceAgentResponse) => Promise<TypedResult>): () => void;
  /**
   * The bar offers its move: the resumable two-write move a typed "move it to ..."
   * uses, which switches the write base and leaves one undo step. The inline sheets
   * (split with, a trip, split by item) run their plan through it. `line` is the
   * sentence shown under the bar afterwards.
   */
  registerMover(
    run: (plan: MovePlan, from: SavedState, line?: string) => Promise<boolean>,
  ): () => void;
}

type Mover = Parameters<SavedBarControls['registerMover']>[0];

export interface SavedBarContext {
  readonly state: SavedState;
  /** Where it went: "Personal" or the group's name. */
  readonly where: string;
  /** What has been filled in so far, in the order it was. */
  readonly filled: readonly FilledKind[];
  readonly controls: SavedBarControls;
}

/** How long "Saved ✓" stays up when there is nothing to ask. */
export const SAVED_BEAT_MS = 1200;

interface Chip {
  readonly label: string;
  readonly onPress: () => void;
  readonly primary?: boolean;
  /** Opens the free-text answer, so it is not a spoken answer's target. */
  readonly freeText?: boolean;
  /** Says the same as Skip, so the card does not draw it. */
  readonly skip?: boolean;
}

/** Rows from the local mirror, shaped for the pure history builder. Read once. */
function useHistorySnapshot(
  viewerId: string | null,
  excludeId: string,
  nowMs: number,
): FollowUpHistory {
  const { mirror, queue } = useSync();
  const ledger = usePersonalLedger();
  const [history] = useState<FollowUpHistory>(() => {
    const groups: HistoryGroup[] = [];
    for (const group of materialiseGroups(mirror, queue) as unknown as GroupRow[]) {
      const members = (
        materialiseMembers(mirror, queue, { groupId: group.id }) as unknown as MemberRow[]
      ).filter((m) => m.left_at === null);
      const expenses: HistoryGroup['expenses'][number][] = [];
      for (const raw of materialiseExpenses(mirror, queue, { groupId: group.id })) {
        const expense = raw as unknown as ExpenseRow;
        const v = expense.currentVersion;
        if (expense.deleted_at || !v) continue;
        let amount = 0n;
        try {
          amount = BigInt(v.amount);
        } catch {
          continue;
        }
        expenses.push({
          id: expense.id,
          authorMemberId: v.author_member_id,
          createdMs: Date.parse(v.created_at || expense.created_at) || 0,
          amountMinor: amount,
          currency: v.currency,
          category: v.category,
          description: v.description,
          date: v.expense_date,
          place: v.location?.name?.trim() || null,
          coords: v.location ? { lat: v.location.lat, lng: v.location.lng } : null,
          participantIds: v.shares.map((s) => s.member_id),
        });
      }
      groups.push({
        id: group.id,
        name: group.name?.trim() || '',
        type: String(group.type),
        startDate: group.start_date,
        endDate: group.end_date,
        archived: group.archived_at !== null,
        members: members.map((m) => ({
          id: m.id,
          name: m.profile?.display_name ?? m.ghost_name ?? '',
          isMe: isViewer(m, viewerId),
        })),
        expenses,
      });
    }
    return buildFollowUpHistory({
      groups,
      personal: ledger.txns
        .filter((txn) => txn.kind === 'expense' && txn.id !== excludeId)
        .map((txn) => ({
          amountMinor: txn.amount,
          currency: txn.currency,
          category: txn.category,
          note: txn.note,
          date: txn.date,
          place: txn.place ?? null,
        })),
      recurringNotes: ledger.recurrings.map((rule) => rule.note ?? ''),
      nowMs,
      excludeExpenseId: excludeId,
    });
  });
  return history;
}

export function VoiceFollowUps({
  initial,
  groupWrite,
  local,
  today,
  onClose,
  onAnswerSource,
  onSavedStateChange,
  renderSavedBar,
  onUndoable,
}: VoiceFollowUpsProps) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const f = t.followUps;
  const toast = useToast();
  const viewerId = useViewerId();
  const prefsHandle = useFollowUpPrefs(viewerId);
  const { prefs } = prefsHandle;

  const [nowMs] = useState(() => Date.now());
  const history = useHistorySnapshot(viewerId, initial.id, nowMs);

  const upsert = useUpsertPersonalRecord();
  const removePersonal = useDeletePersonalRecord();
  const personalLedger = usePersonalLedger();
  // The saved bar's executor for an agent reply (see `registerExecutor`).
  const executorBox = useRef<((response: VoiceAgentResponse) => Promise<TypedResult>) | null>(null);
  const writeExpense = useWriteExpense(initial.groupId ?? '');
  const removeExpense = useDeleteExpense(initial.groupId ?? '');
  const createGroupRecurring = useCreateGroupRecurring(initial.groupId ?? '');
  const { mirror, queue, mutate } = useSync();

  const [saved, setSaved] = useState<SavedState>(initial);
  // A bill already scanned for this group with the same total and its lines read:
  // the only case "Split by item" is offered.
  const openReceipts = useOpenReceipts(initial.kind === 'group' ? (initial.groupId ?? '') : '');
  const [session, setSession] = useState<FollowUpSession>(NEW_SESSION);
  const [filled, setFilled] = useState<FilledKind[]>([]);
  // A saved bar is in use (a correction, an undo): the panel stays until Done.
  const [held, setHeld] = useState(false);
  const [env, setEnv] = useState<FollowUpEnvironment | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [handedOff, setHandedOff] = useState(false);
  const [wrapUpOnScreen, setWrapUpOnScreen] = useState<string | null>(null);
  // Inline answers (nothing here leaves the voice screen): the sheet that is open,
  // the loan being shared, the group being settled, and the line that says it is done.
  const [sheet, setSheet] = useState<InlineSheetRequest | null>(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [sharing, setSharing] = useState<PersonalLoan | null>(null);
  const [settleGroupId, setSettleGroupId] = useState<string | null>(null);
  const [doneNote, setDoneNote] = useState<string | null>(null);
  const sheetLock = useRef(false);
  // One id per (expense, destination) until the move completes, so a retry after a
  // half-done move resumes the entry already written instead of making a second.
  const moveIds = useRef(new Map<string, string>());
  // The id a split-by-item expense is written under (also the seed of its remainder).
  const [itemizeSeed] = useState(() => randomUUID());
  const moverBox = useRef<Mover | null>(null);
  const fallbackProgress = useRef<MoveProgress | null>(null);
  const attachedRef = useRef<() => void>(() => undefined);
  const removedRef = useRef<() => void>(() => undefined);
  // Typing and the mic need the network; the chips work from the phone alone.
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let live = true;
    void checkOnline().then((ok) => {
      if (live) setOnline(ok);
    });
    return () => {
      live = false;
    };
  }, []);
  // Model turns spent on this expense, typed and spoken together (D1: three).
  const [turnsUsed, setTurnsUsed] = useState(0);
  const turnsRef = useRef(0);
  const answerRef = useRef<(text: string) => void>(() => undefined);
  const canType = online && turnsUsed < FOLLOW_UP_TURN_CAP;
  const voice = useVoiceReply({
    onTranscript: (text) => answerRef.current(text),
    groupId: initial.groupId ?? null,
    locale,
    online,
    turnsUsed,
  });
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const receipt = useInlineReceipt({
    groupId: saved.kind === 'group' ? saved.groupId : null,
    expenseId: saved.id,
    onAttached: () => attachedRef.current(),
    onRemoved: () => removedRef.current(),
  });

  // Where the phone is — only when permission was already granted; nothing here prompts.
  useEffect(() => {
    let live = true;
    void currentPlaceIfGranted().then((place) => {
      if (!live) return;
      if (place) setHere({ lat: place.lat, lng: place.lng });
      setEnv({
        currentPlace: place?.name ?? null,
        deviceCurrency: place ? deviceCurrencyFor(place.countryCode, initial.currency) : null,
        hour: new Date().getHours(),
        nowMs: Date.now(),
        today,
      });
    });
    return () => {
      live = false;
    };
  }, [initial.currency, today]);

  const group = useMemo(
    () => local.groups.find((g) => g.id === saved.groupId) ?? null,
    [local.groups, saved.groupId],
  );
  const myMemberId = group?.members.find((m) => m.isViewer)?.id ?? null;
  const payerMemberId = saved.payers ? (Object.keys(saved.payers)[0] ?? null) : null;

  const question: FollowUpQuestion | null = useMemo(() => {
    if (!env || !prefsHandle.ready || handedOff) return null;
    return nextFollowUp({
      expense: factsFor(
        saved,
        group
          ? {
              name: group.name,
              members: group.members.map((m) => ({ id: m.id, name: m.name, isMe: m.isViewer })),
            }
          : null,
        payerMemberId,
        myMemberId,
      ),
      history: history.stats,
      // The wrap-up is marked shown the moment it appears; it must stay on
      // screen until it is answered, so the group being asked is not excluded yet.
      prefs: wrapUpOnScreen
        ? { ...prefs, wrapUpShown: prefs.wrapUpShown.filter((g) => g !== wrapUpOnScreen) }
        : prefs,
      session,
      env,
    });
  }, [
    env,
    prefsHandle.ready,
    handedOff,
    saved,
    group,
    payerMemberId,
    myMemberId,
    history,
    prefs,
    session,
    wrapUpOnScreen,
  ]);

  // The trip wrap-up is asked once per group, so it is marked the moment it shows.
  useEffect(() => {
    if (question?.kind === 'wrapup' && saved.groupId) {
      const id = saved.groupId;
      // Remembers which group's wrap-up is showing, once, as it appears.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWrapUpOnScreen(id);
      prefsHandle.update((p) => markWrapUpShown(p, id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question?.kind]);

  const startVoice = (): void => {
    setNotice(null);
    setTyping(false);
    voice.start();
  };
  const voiceNote =
    voice.problem === 'denied'
      ? f.micDenied
      : voice.problem === 'empty'
        ? f.noSpeech
        : voice.problem === 'failed'
          ? f.voiceFailed
          : null;
  const limitNote = !online
    ? f.typingOffline
    : turnsUsed >= FOLLOW_UP_TURN_CAP
      ? f.turnsUsed
      : null;
  // The last result stays visible; when it used the final turn, say why the
  // mic and the typed field are gone.
  const caption =
    notice && limitNote && notice !== limitNote
      ? `${notice} ${limitNote}`
      : (notice ?? voiceNote ?? limitNote);

  const ready = env !== null && prefsHandle.ready;
  const finished = ready && question === null;

  // Nothing worth asking: a visible "Saved ✓" beat, then close as before.
  const emptyBeat =
    finished && session.asked.length === 0 && filled.length === 0 && !handedOff && !held;
  useEffect(() => {
    if (!emptyBeat) return undefined;
    // With an undo bar the beat is the undo window: closing sooner would take Undo away.
    const timer = setTimeout(
      () => {
        toast.show(t.voice.agentDone);
        onClose();
      },
      renderSavedBar ? UNDO_RING_MS : SAVED_BEAT_MS,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emptyBeat]);

  const splittable =
    saved.kind === 'group' ? findSplittableReceipt(openReceipts.data, saved.amount) : null;
  // The bill's lines for this total, or null when they cannot be split by item.
  const itemize = useMemo(() => {
    if (!splittable?.parsed) return null;
    const start = itemizeDraftFor(splittable.parsed, saved.amount);
    return start.ok ? { draft: start.draft, receiptId: splittable.id } : null;
  }, [splittable, saved.amount]);
  const category = saved.category;
  const amountLabel = format(money(saved.amount, saved.currency), { locale });
  const whereLabel = saved.kind === 'group' ? (group?.name ?? '') : f.wherePersonal;
  const categoryLabel = (id: string): string => (t.categories as Record<string, string>)[id] ?? id;

  // ── answering ────────────────────────────────────────────────────────────

  const persist = useCallback(
    async (next: SavedState): Promise<boolean> => {
      setBusy(true);
      try {
        if (next.kind === 'personal') {
          await upsert.mutateAsync({
            recordId: next.id,
            recordKind: 'txn',
            data: toPersonalData(next),
          });
        } else if (groupWrite) {
          await writeExpense.mutateAsync(toGroupWrite(groupWrite, next));
        }
        setSaved(next);
        onSavedStateChange?.(next);
        return true;
      } catch {
        setNotice(f.couldNotSave);
        return false;
      } finally {
        setBusy(false);
      }
    },
    // The mutation hooks are stable per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groupWrite, f.couldNotSave, onSavedStateChange],
  );

  const respond = (
    kind: FollowUpKind,
    outcome: 'answered' | 'skipped' | 'dismissed' | 'done',
  ): void => {
    setNotice(null);
    setTyping(false);
    voice.cancel();
    setSession((s) => advanceSession(s, kind, outcome));
    if (outcome === 'answered') prefsHandle.update((p) => recordAnswer(p, kind, category));
    else if (outcome === 'skipped') prefsHandle.update((p) => recordSkip(p, kind, category));
  };

  const answerWith = async (q: FollowUpKind, answer: FollowUpAnswer): Promise<void> => {
    if (busy) return;
    if (await persist(applyAnswer(saved, answer))) {
      setFilled((list) => [...list, filledBy(answer)]);
      respond(q, 'answered');
    }
  };

  // ── inline answers: sheets and in-card UI, never another screen ──────────────

  useEffect(() => {
    // The receipt hook calls these when its upload finishes or the bill is taken off.
    attachedRef.current = () => {
      const next = { ...saved, hasReceipt: true };
      setSaved(next);
      onSavedStateChange?.(next);
      setDoneNote(t.inline.receiptDone);
      respond('receipt', 'answered');
    };
    removedRef.current = () => {
      const next = { ...saved, hasReceipt: false };
      setSaved(next);
      onSavedStateChange?.(next);
      setDoneNote(null);
    };
  });

  /** Run a move through the saved bar (resumable, undoable); without a bar, directly. */
  const runSheetMove = async (plan: MovePlan, line?: string): Promise<boolean> => {
    const mover = moverBox.current;
    if (mover) return mover(plan, saved, line);
    return runMove(fallbackProgress, plan, saved, {
      writeDestination: async (p) => {
        if (p.kind === 'toGroup') {
          await mutate(MutationKind.ExpenseCreate, p.groupId, {
            ...serialiseExpense(p.write),
            expenseId: p.write.expenseId,
          });
        } else {
          await upsert.mutateAsync({ recordId: p.recordId, recordKind: 'txn', data: p.data });
        }
      },
      removeSource: async (from) => {
        if (from.kind === 'group' && from.groupId) {
          await mutate(MutationKind.ExpenseDelete, from.groupId, { expenseId: from.id });
        } else {
          await removePersonal.mutateAsync(from.id);
        }
      },
      removeDestination: async (d) => {
        if (d.kind === 'group') {
          await mutate(MutationKind.ExpenseDelete, d.groupId, { expenseId: d.id });
        } else {
          await removePersonal.mutateAsync(d.id);
        }
      },
      completed: (p) => {
        setSaved(p.next);
        onSavedStateChange?.(p.next);
      },
    });
  };

  const closeSheet = (): void => {
    if (sheetLock.current) return;
    setSheet(null);
    setSheetError(null);
  };

  /** The sheet saved: the question is answered and nothing more is asked about this expense. */
  const sheetDone = (request: InlineSheetRequest, note: string): void => {
    setSheet(null);
    setSheetError(null);
    setDoneNote(note);
    if (request.from) respond(request.from, 'answered');
    setHandedOff(true);
  };

  /** One write at a time: a second tap while it runs does nothing; a failure keeps the sheet open to retry. */
  const submitSheet = async (
    request: InlineSheetRequest,
    write: () => Promise<boolean>,
    note: string,
  ): Promise<void> => {
    const out = await runOnce(sheetLock, async () => {
      setSheetBusy(true);
      setSheetError(null);
      try {
        return await write();
      } catch {
        return false;
      } finally {
        setSheetBusy(false);
      }
    });
    if (!out.ran) return;
    if (out.value) sheetDone(request, note);
    else setSheetError(f.couldNotSave);
  };

  // The id is per (expense, destination, people): a changed pick after a half-done move
  // is a different entry, so the earlier one is taken back out instead of silently kept.
  const moveIdFor = (groupId: string, people: readonly string[] = []): string => {
    const key = `${saved.id}>${groupId}>${[...people].sort().join(',')}`;
    let id = moveIds.current.get(key);
    if (!id) {
      id = randomUUID();
      moveIds.current.set(key, id);
    }
    return id;
  };

  const groupName = (id: string): string => local.groups.find((g) => g.id === id)?.name ?? '';

  const onSheetMove = (request: InlineSheetRequest, groupId: string, memberIds: string[]): void => {
    const plan = planSplitMove(saved, local, groupId, memberIds, moveIdFor(groupId, memberIds));
    if (!plan) {
      setSheetError(f.couldNotSave);
      return;
    }
    const names = (local.groups.find((g) => g.id === groupId)?.members ?? [])
      .filter((m) => !m.isViewer && memberIds.includes(m.id))
      .map((m) => m.name);
    const note =
      request.kind === 'trip' || names.length === 0
        ? fill(t.inline.movedDone, { group: groupName(groupId) })
        : fill(t.inline.splitDone, { names: names.join(', ') });
    void submitSheet(request, () => runSheetMove(plan), note);
  };

  const onSheetAttendance = (request: InlineSheetRequest, memberIds: string[]): void => {
    const next = planAttendance(saved, memberIds);
    if (!next) {
      sheetDone(request, t.inline.attendanceDone);
      return;
    }
    void submitSheet(
      request,
      async () => {
        const before = saved;
        if (!(await persist(next))) return false;
        onUndoable?.({ kind: 'edit', previous: before, what: 'answer' });
        return true;
      },
      t.inline.attendanceDone,
    );
  };

  const onSheetItemize = (request: InlineSheetRequest, claims: Claims): void => {
    if (request.kind !== 'itemize') return;
    const plan = planItemize(saved, request.draft, claims, local, request.receiptId, request.seed);
    if (!plan) {
      setSheetError(f.couldNotSave);
      return;
    }
    void submitSheet(request, () => runSheetMove(plan, t.inline.itemizeDone), t.inline.itemizeDone);
  };

  /**
   * One path for every free-text answer, typed or spoken: a chip the words name
   * is pressed on the phone, then the local readers, and only what is left costs
   * a model turn, up to {@link FOLLOW_UP_TURN_CAP} per expense.
   */
  const submitAnswer = async (text: string, source: 'typed' | 'voice'): Promise<void> => {
    if (busy) return;
    if (question) {
      const chips = chipsFor(question);
      const at = matchChip(text, chips);
      const chip = at >= 0 ? chips[at] : undefined;
      if (chip && !chip.freeText) {
        onAnswerSource?.(source, 'chip');
        chip.onPress();
        return;
      }
    }
    // Most typed answers are a place, a payment word, a number or a day: read on
    // the phone first, so they cost no agent turn and work offline.
    const reading = readLocally({
      text,
      state: saved,
      today,
      locale,
      local,
      places: history.stats.recentPlaces,
      placeCoords: history.placeCoords,
      categories: Object.keys(t.categories),
      categoryLabel,
    });
    if (reading) onAnswerSource?.(source, 'chip');
    if (reading?.kind === 'answer' && question) {
      setTyping(false);
      await answerWith(question.kind, reading.answer);
      return;
    }
    if (reading?.kind === 'fields' && !('groupId' in reading.fields)) {
      const next = applyCorrectionFields(saved, reading.fields);
      const changed = changedFields(saved, next);
      if (changed.length === 0) {
        setNotice(t.corrections.unchanged);
      } else if (await persist(next)) {
        setTyping(false);
        setNotice(correctionLine(next, changed, { strings: t.corrections, locale, local }));
      }
      return;
    }
    if (turnsRef.current >= FOLLOW_UP_TURN_CAP) {
      setNotice(f.turnsUsed);
      return;
    }
    turnsRef.current += 1;
    setTurnsUsed(turnsRef.current);
    onAnswerSource?.(source, 'model');
    setBusy(true);
    setNotice(null);
    const result = await sendVoiceTranscript({
      transcript: text,
      groupId: saved.groupId,
      locale,
      today,
      savedExpense: {
        id: saved.id,
        kind: saved.kind,
        groupId: saved.groupId,
        ...(question
          ? { question: questionText(question, f, { saved, group, amountLabel, categoryLabel }) }
          : {}),
      },
    });
    setBusy(false);
    const response = result.kind === 'ok' ? result.response : null;
    const update = response?.update;
    const viaBar = executorBox.current;
    if (!response || (!update && !response.delete)) {
      setNotice(f.couldNotUse);
      return;
    }
    // The same executor typed corrections use: amount, date, description,
    // currency, payer, a move or a delete are applied (and undoable), not only
    // the follow-up answers. Without a saved bar the answers alone are written.
    const outcome: TypedResult = viaBar
      ? await viaBar(response)
      : await applyAgentResponse(
          {
            text,
            state: saved,
            today,
            locale,
            local,
            strings: t.corrections,
            online: true,
            newId: () => saved.id,
            places: history.stats.recentPlaces,
            placeCoords: history.placeCoords,
            categories: Object.keys(t.categories),
            categoryLabel,
          },
          { persist, move: async () => false, send: async () => ({ kind: 'error' }) },
          response,
        );
    if (outcome.kind === 'undo') {
      setTyping(false);
      return;
    }
    const applied = outcome.kind === 'corrected' || outcome.kind === 'answered';
    const moved = outcome.kind === 'corrected' && outcome.moved;
    const plan = update ? planUpdate(update, saved) : null;
    const handoff = !moved && plan && (plan.wantsReceipt || plan.splitWith);
    if (!applied && !handoff) {
      // The bar already said why; without one, say it here.
      if (!viaBar) setNotice(outcome.kind === 'failed' ? f.couldNotSave : f.couldNotUse);
      return;
    }
    if (!viaBar && outcome.kind === 'answered') {
      setFilled((list) => [...list, ...outcome.answers.map(filledBy)]);
    }
    setTyping(false);
    if (question) respond(question.kind, 'answered');
    if (plan && handoff && plan.wantsReceipt && saved.groupId) {
      // The bill is scanned right here; the camera opens over the panel.
      receipt.scan();
    } else if (plan && handoff && plan.splitWith) {
      setSheet({
        kind: 'split',
        groupId: plan.splitWith.groupId,
        memberIds: plan.splitWith.memberIds,
        from: null,
      });
    } else if (!viaBar) {
      setNotice(f.gotIt);
    }
  };

  // ── per-question chips ───────────────────────────────────────────────────

  const chipsFor = (q: FollowUpQuestion): Chip[] => {
    const no = (label = f.no): Chip => ({
      label,
      onPress: () => respond(q.kind, 'skipped'),
      skip: true,
    });
    const yes = (label: string, run: () => void | Promise<void>): Chip => ({
      label,
      primary: true,
      onPress: () => void run(),
    });
    switch (q.kind) {
      case 'place':
        return [
          ...q.places.map((name, index) =>
            yes(name, () =>
              answerWith('place', {
                kind: 'place',
                name,
                coords: index === 0 && q.hereNow ? (here ?? undefined) : history.placeCoords[name],
              }),
            ),
          ),
          ...(online
            ? [{ label: f.placeElse, onPress: () => setTyping(true), freeText: true }]
            : []),
        ];
      case 'receipt':
        return [
          yes(f.receiptScan, () => receipt.scan()),
          yes(f.receiptPick, () => receipt.pick()),
          ...(itemize
            ? [
                yes(f.splitByItem, () =>
                  setSheet({
                    kind: 'itemize',
                    ...itemize,
                    seed: itemizeSeed,
                    from: 'receipt',
                  }),
                ),
              ]
            : []),
          no(),
        ];
      case 'split':
        return [
          ...q.partners.map((partner) =>
            yes(partner.name, () =>
              setSheet({
                kind: 'split',
                groupId: partner.groupId,
                memberIds: [partner.memberId],
                from: 'split',
              }),
            ),
          ),
          ...(online
            ? [{ label: f.splitSomeone, onPress: () => setTyping(true), freeText: true }]
            : []),
          no(),
        ];
      case 'payment':
        return [
          ...paymentChoices(saved.kind).map((method) =>
            yes(paymentLabel(method, f), () => answerWith('payment', { kind: 'payment', method })),
          ),
        ];
      case 'trip': {
        const trip = q.trip;
        if (!trip) return [no()];
        return [
          yes(fill(f.tripMove, { trip: trip.name }), () =>
            setSheet({ kind: 'trip', groupId: trip.groupId, from: 'trip' }),
          ),
          no(f.tripNo),
        ];
      }
      case 'attendance':
        return [
          yes(f.attendanceEveryone, () => respond('attendance', 'answered')),
          yes(f.attendancePick, () => setSheet({ kind: 'attendance', from: 'attendance' })),
        ];
      case 'payer': {
        const payer = q.payer;
        if (!payer) return [no()];
        return [
          yes(fill(f.payerYes, { name: firstName(payer.name) }), () =>
            answerWith('payer', { kind: 'payer', memberId: payer.id }),
          ),
          no(f.payerNo),
        ];
      }
      case 'recurring':
        return [
          yes(f.recurringYes, async () => {
            setBusy(true);
            try {
              // A group expense repeats as a group rule (the server posts each
              // one for everybody); a personal one stays a personal reminder.
              if (saved.kind === 'group') {
                const version = (
                  materialiseExpenses(mirror, queue, {
                    groupId: saved.groupId ?? '',
                  }) as unknown as ExpenseRow[]
                ).find((row) => row.id === saved.id)?.currentVersion;
                const plan = groupRecurringFor(saved, version ?? null);
                if (!plan) {
                  setNotice(f.couldNotSave);
                  return;
                }
                await createGroupRecurring.mutateAsync({
                  ruleId: deterministicId(`recurring:${saved.id}`),
                  ...plan,
                });
                setFilled((list) => [...list, 'recurring']);
                respond('recurring', 'answered');
                return;
              }
              await upsert.mutateAsync({
                recordKind: 'recurring',
                data: encodeRecurring({
                  txnKind: 'expense',
                  amount: saved.amount,
                  currency: saved.currency,
                  category: saved.category,
                  note: saved.description,
                  ...scheduleFor(Frequency.Monthly),
                  anchorDate: saved.date,
                  nextDate: nextMonthlyDate(saved.date),
                  endDate: null,
                  // A reminder, not a silent debit: the person confirms each month.
                  autoPost: false,
                  active: true,
                }),
              });
              setFilled((list) => [...list, 'recurring']);
              respond('recurring', 'answered');
            } catch {
              setNotice(f.couldNotSave);
            } finally {
              setBusy(false);
            }
          }),
          no(),
        ];
      case 'duplicate':
        return [
          yes(f.duplicateSame, async () => {
            setBusy(true);
            try {
              // The full record is read BEFORE the delete hides it, for the undo.
              const carried =
                saved.kind === 'personal'
                  ? personalLedger.txns.find((txn) => txn.id === saved.id)?.carried
                  : undefined;
              await removeExpense.mutateAsync(saved.id);
              onUndoable?.({ kind: 'duplicate', previous: saved, carried });
              setFilled((list) => [...list, 'duplicate']);
              respond('duplicate', 'answered');
              // The expense is gone: there is nothing left to ask about.
              setSession((s) => ({ ...s, stopped: true }));
              setNotice(f.removedDuplicate);
            } catch {
              setNotice(f.couldNotSave);
            } finally {
              setBusy(false);
            }
          }),
          { label: f.duplicateDifferent, onPress: () => respond('duplicate', 'answered') },
        ];
      case 'currency': {
        const code = q.currency ?? saved.currency;
        return [
          yes(code, () => answerWith('currency', { kind: 'currency', currency: code })),
          no(fill(f.currencyKeep, { currency: saved.currency })),
        ];
      }
      case 'category':
        return [
          ...(q.categories ?? []).map((id) =>
            yes(categoryLabel(id), () =>
              answerWith('category', { kind: 'category', category: id }),
            ),
          ),
        ];
      case 'date':
        return [
          yes(f.dateYes, () =>
            answerWith('date', { kind: 'date', date: q.suggestedDate ?? saved.date }),
          ),
          { label: f.dateNo, onPress: () => respond('date', 'answered') },
        ];
      case 'lend': {
        const person = q.person ?? '';
        // Money lent is not money spent: it becomes a loan and leaves the
        // expenses. With `share` the loan is then offered to the other person
        // (a debt in a 1:1 group they can see and settle), via the loans screen.
        const lend = (share: boolean) => async () => {
          setBusy(true);
          try {
            const loanId = await upsert.mutateAsync({
              recordKind: 'loan',
              data: encodeLoan({
                direction: 'lent',
                counterpart: cleanCounterpart(person),
                principal: saved.amount,
                currency: saved.currency,
                note: null,
                startDate: saved.date,
                status: 'active',
              }),
            });
            const carried = personalLedger.txns.find((txn) => txn.id === saved.id)?.carried;
            await removePersonal.mutateAsync(saved.id);
            onUndoable?.({ kind: 'lend', previous: saved, loanId, carried });
            setFilled((list) => [...list, 'lend']);
            respond('lend', 'answered');
            setSession((s) => ({ ...s, stopped: true }));
            // Shared right here: the card shows the outcome (and Try again on a failure).
            if (share) setSharing(lentLoan({ id: loanId, person, saved }));
          } catch {
            setNotice(f.couldNotSave);
          } finally {
            setBusy(false);
          }
        };
        return [
          yes(fill(f.lendYes, { name: person }), lend(false)),
          ...(person ? [yes(fill(f.lendShare, { name: person }), lend(true))] : []),
          { label: f.lendNo, onPress: () => respond('lend', 'answered') },
        ];
      }
      case 'wrapup':
        return [
          yes(f.wrapupYes, () => {
            respond('wrapup', 'answered');
            setHandedOff(true);
            setSettleGroupId(saved.groupId);
          }),
          no(f.wrapupNo),
        ];
      case 'work':
        return [yes(f.workYes, () => answerWith('work', { kind: 'work' })), no()];
    }
  };

  useEffect(() => {
    answerRef.current = (text) => void submitAnswer(text, 'voice');
  });

  const controls: SavedBarControls = useMemo(
    () => ({
      replaceSaved: (next) => {
        setHeld(true);
        setSaved(next);
        onSavedStateChange?.(next);
      },
      addFilled: (kinds) => setFilled((list) => [...list, ...kinds]),
      popFilled: () => setFilled((list) => list.slice(0, -1)),
      stop: () => {
        setHeld(true);
        setSession((s) => ({ ...s, stopped: true }));
      },
      hold: () => setHeld(true),
      registerExecutor: (run) => {
        executorBox.current = run;
        return () => {
          if (executorBox.current === run) executorBox.current = null;
        };
      },
      registerMover: (run) => {
        moverBox.current = run;
        return () => {
          if (moverBox.current === run) moverBox.current = null;
        };
      },
    }),
    [onSavedStateChange, executorBox],
  );

  // ── render ───────────────────────────────────────────────────────────────

  const items = dedupeFilled(filled)
    .map((kind) => itemLabel(kind, f))
    .filter(Boolean);
  const summary = items.length > 0 ? fill(f.savedWith, { items: items.join(' + ') }) : f.saved;

  return (
    <View style={{ gap: theme.spacing.md }}>
      {renderSavedBar ? (
        // `controls` only touches the executor box inside callbacks, never while rendering.
        // eslint-disable-next-line react-hooks/refs
        renderSavedBar({ state: saved, where: whereLabel, filled, controls })
      ) : (
        <SavedSummary
          amount={amountLabel}
          detail={[category ? categoryLabel(category) : '', whereLabel].filter(Boolean).join(' · ')}
        />
      )}

      {question ? (
        <View
          style={{
            gap: theme.spacing.sm,
            padding: theme.spacing.md,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.color.surface,
            borderWidth: 1,
            borderColor: theme.color.border,
          }}
        >
          <Text style={{ fontWeight: '700' }}>
            {questionText(question, f, { saved, group, amountLabel, categoryLabel })}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
            {visibleChips(chipsFor(question)).map((chip) => (
              <Pressable
                key={chip.label}
                accessibilityRole="button"
                accessibilityLabel={chip.label}
                disabled={busy}
                onPress={() => {
                  hapticSelect();
                  chip.onPress();
                }}
                style={({ pressed }) => ({
                  paddingHorizontal: theme.spacing.md,
                  minHeight: 48,
                  maxWidth: '100%',
                  justifyContent: 'center',
                  borderRadius: theme.radius.pill,
                  backgroundColor: chip.primary ? theme.color.brandSoft : theme.color.bg,
                  borderWidth: 1,
                  borderColor: chip.primary ? theme.color.brand : theme.color.border,
                  opacity: busy ? 0.5 : pressed ? 0.7 : 1,
                })}
              >
                <Text numberOfLines={1} style={{ color: theme.color.text, fontWeight: '700' }}>
                  {chipLabel(chip.label)}
                </Text>
              </Pressable>
            ))}
          </View>
          {voice.phase !== 'idle' ? (
            <ListeningRow
              transcribing={voice.phase === 'transcribing'}
              heard={voice.live}
              listeningLabel={f.listening}
              workingLabel={f.transcribing}
              stopLabel={f.stopListening}
              onStop={voice.stop}
            />
          ) : null}
          {(typing || voice.problem === 'denied') && canType ? (
            <VoiceTypedAnswer
              onSubmit={(text) => void submitAnswer(text, 'typed')}
              onVoice={voice.off === null ? startVoice : undefined}
            />
          ) : null}
          {caption && (notice || typing || voice.problem) ? (
            <Text variant="caption" tone="muted">
              {caption}
            </Text>
          ) : null}
          <View style={{ alignSelf: 'flex-start' }}>
            <TextAction label={f.skip} muted onPress={() => respond(question.kind, 'skipped')} />
          </View>
        </View>
      ) : null}

      <InlineReceiptStatus receipt={receipt} />
      {sharing ? <InlineLoanShare loan={sharing} loans={personalLedger.loans} /> : null}
      {settleGroupId ? <InlineSettle groupId={settleGroupId} /> : null}

      {finished && (doneNote || filled.length > 0 || handedOff) ? (
        <View style={{ gap: theme.spacing.xs }}>
          <Text tone="muted" align="center">
            {doneNote ?? (handedOff && filled.length === 0 ? f.handedOff : summary)}
          </Text>
          {notice ? (
            <Text variant="caption" tone="muted" align="center">
              {notice}
            </Text>
          ) : null}
        </View>
      ) : null}

      <InlineSheetHost
        request={sheet}
        saved={saved}
        local={local}
        amountLabel={amountLabel}
        busy={sheetBusy}
        error={sheetError}
        onMove={onSheetMove}
        onAttendance={onSheetAttendance}
        onItemize={onSheetItemize}
        onClose={closeSheet}
      />
    </View>
  );
}

/** The mic is open: what is heard so far (or a plain label), and a way to end it. */
function ListeningRow({
  transcribing,
  heard,
  listeningLabel,
  workingLabel,
  stopLabel,
  onStop,
}: {
  transcribing: boolean;
  heard: string;
  listeningLabel: string;
  workingLabel: string;
  stopLabel: string;
  onStop: () => void;
}) {
  const theme = useTheme();
  const label = transcribing ? workingLabel : listeningLabel;
  return (
    <View
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        minHeight: 40,
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radius.pill,
        borderWidth: 1,
        borderColor: theme.color.brand,
        backgroundColor: theme.color.brandSoft,
      }}
    >
      <Ionicons name="mic" size={iconSize.base} color={theme.color.brand} />
      <Text numberOfLines={1} style={{ flex: 1, color: theme.color.brand }}>
        {heard && !transcribing ? heard : label}
      </Text>
      {transcribing ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={stopLabel}
          onPress={onStop}
          hitSlop={8}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Text variant="micro" style={{ color: theme.color.brand, fontWeight: '700' }}>
            {stopLabel}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

function paymentLabel(method: string, f: UiStrings['followUps']): string {
  switch (method) {
    case 'cash':
      return f.payCash;
    case 'upi':
      return f.payUpi;
    case 'card':
      return f.payCard;
    case 'credit':
      return f.payCredit;
    case 'debit':
      return f.payDebit;
    default:
      return method;
  }
}

function itemLabel(kind: FilledKind, f: UiStrings['followUps']): string {
  switch (kind) {
    case 'place':
      return f.itemPlace;
    case 'payment':
      return f.itemPayment;
    case 'category':
      return f.itemCategory;
    case 'date':
      return f.itemDate;
    case 'payer':
      return f.itemPayer;
    case 'currency':
      return f.itemCurrency;
    case 'recurring':
      return f.itemRecurring;
    case 'lend':
      return f.itemLend;
    case 'work':
      return f.itemWork;
    default:
      return '';
  }
}

/** The question in the person's own terms: place names, people, trips. */
export function questionText(
  q: FollowUpQuestion,
  f: UiStrings['followUps'],
  ctx: {
    saved: SavedState;
    group: { name: string } | null;
    amountLabel: string;
    categoryLabel: (id: string) => string;
  },
): string {
  switch (q.kind) {
    case 'place':
      return f.placeAsk;
    case 'receipt':
      return f.receiptAsk;
    case 'split':
      return fill(f.splitAsk, {
        category: ctx.categoryLabel(ctx.saved.category ?? 'other').toLowerCase(),
        name: q.partners[0]?.name ?? '',
      });
    case 'payment':
      return f.paymentAsk;
    case 'trip':
      return fill(f.tripAsk, { trip: q.trip?.name ?? '' });
    case 'attendance':
      return f.attendanceAsk;
    case 'payer':
      return fill(f.payerAsk, { name: firstName(q.payer?.name ?? '') });
    case 'recurring':
      return f.recurringAsk;
    case 'duplicate':
      return fill(f.duplicateAsk, {
        name: firstName(q.duplicate?.authorName ?? ''),
        amount: q.duplicate
          ? format(money(q.duplicate.amountMinor, q.duplicate.currency))
          : ctx.amountLabel,
        description: q.duplicate?.description ?? '',
      });
    case 'currency':
      return fill(f.currencyAsk, { currency: q.currency ?? '' });
    case 'category':
      return f.categoryAsk;
    case 'date':
      return f.dateAsk;
    case 'lend':
      return fill(f.lendAsk, { name: q.person ?? '' });
    case 'wrapup':
      return fill(f.wrapupAsk, { trip: q.trip?.name ?? ctx.group?.name ?? '' });
    case 'work':
      return f.workAsk;
  }
}
