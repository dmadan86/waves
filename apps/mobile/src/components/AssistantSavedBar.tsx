/**
 * The line under a saved assistant expense: "✓ Added ₹8,000 to Personal  Undo".
 * Undo wears a 6 second ring, then stays as a plain link until the panel closes.
 * Under it, a "Change" link opens a one-line composer where a correction
 * ("make it 800", "it was yesterday", "that was in Flat 4B") is applied on the
 * phone with no network, and the last correction or answer can be taken back.
 *
 * The follow-up panel owns the saved state; this bar edits it through the
 * `controls` it is given, and keeps the undo history itself.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { Pressable, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { MutationKind, format, money, type VoiceAgentResponse } from '@waves/core';
import { iconSize, Text, useTheme } from '@waves/ui';

import type { SavedBarControls } from '@/components/VoiceFollowUps';
import { VoiceTypedAnswer } from '@/components/VoiceTypedAnswer';
import { useSyncedLoanNets } from '@/data/hooks';
import { useViewerId } from '@/lib/auth';
import {
  useDeletePersonalRecord,
  useUpsertPersonalRecord,
  usePersonalLedger,
} from '@/data/personal';
import { serialiseExpense } from '@/data/serialiseExpense';
import { fill, useStrings } from '@/i18n';
import {
  applyAgentResponse,
  correctionLine,
  runTypedMessage,
  type MovePlan,
  type TypedDeps,
  type TypedResult,
} from '@/lib/assistantCorrections';
import {
  UNDO_RING_MS,
  historyEntryFor,
  pushHistory,
  restoreSaved,
  sharedDebtSettled,
  undoLastDetailed,
  undoSaved,
  type UndoDeps,
  type UndoEntry,
} from '@/lib/assistantUndo';
import { filledBy, toGroupWrite, toPersonalData, type SavedState } from '@/lib/followUpApply';
import { hapticLight } from '@/lib/assistantHaptics';
import { runMove, type MoveProgress } from '@/lib/assistantMove';
import { useReducedMotion } from '@/lib/reducedMotion';
import { forgetMove, lastRememberedMove } from '@/lib/personalHandoff';
import { sendVoiceTranscript } from '@/lib/voiceAgent';
import type { AgentExpenseWrite, AgentLocalData } from '@/lib/voiceAgentPlan';
import { checkOnline } from '@/lib/voiceStream';
import { useSync } from '@/sync';

export interface AssistantBarContext {
  readonly state: SavedState;
  /** "Added ₹8,000 to Personal" */
  readonly headline: string;
}

/** A tally the panel can forward to telemetry; the bar has no opinion about where it goes. */
export type SavedBarEvent =
  | {
      readonly name: 'assistant_correction';
      readonly field: 'amount' | 'date' | 'description' | 'group' | 'currency';
      readonly path: 'device' | 'llm';
    }
  | { readonly name: 'assistant_undo'; readonly what: 'expense' | 'answer' | 'handoff' };

export interface AssistantSavedBarProps {
  context: AssistantBarContext;
  controls: SavedBarControls;
  /** The group write the expense was saved with; null for a personal one. */
  groupWrite: AgentExpenseWrite | null;
  local: AgentLocalData;
  today: string;
  /** Moves and hand-offs the panel did on its own, to be undoable here. */
  externalEntry?: UndoEntry | null;
  onEvent?: (event: SavedBarEvent) => void;
}

const RING = 16;
const STROKE = 2;
const RADIUS = (RING - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** A 16 px ring that empties over {@link UNDO_RING_MS}; a static dot when motion is reduced. */
function UndoRing({ color, track, still }: { color: string; track: string; still: boolean }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    if (still) return;
    progress.value = withTiming(1, { duration: UNDO_RING_MS, easing: Easing.linear });
  }, [progress, still]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: CIRCUMFERENCE * progress.value }));
  return (
    <Svg width={RING} height={RING} accessibilityElementsHidden importantForAccessibility="no">
      <Circle
        cx={RING / 2}
        cy={RING / 2}
        r={RADIUS}
        stroke={track}
        strokeWidth={STROKE}
        fill="none"
      />
      <AnimatedCircle
        cx={RING / 2}
        cy={RING / 2}
        r={RADIUS}
        stroke={color}
        strokeWidth={STROKE}
        fill="none"
        strokeDasharray={CIRCUMFERENCE}
        animatedProps={props}
        strokeLinecap="round"
        rotation={-90}
        origin={`${RING / 2}, ${RING / 2}`}
      />
    </Svg>
  );
}

function Link({
  label,
  onPress,
  accessibilityLabel,
  disabled,
  brand,
  children,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
  brand?: boolean;
  children?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.xs,
        opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
      })}
    >
      {children}
      <Text
        variant="micro"
        style={{ color: brand ? theme.color.brand : theme.color.textMuted, fontWeight: '700' }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function AssistantSavedBar({
  context,
  controls,
  groupWrite,
  local,
  today,
  externalEntry,
  onEvent,
}: AssistantSavedBarProps) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const c = t.corrections;
  const reduceMotion = useReducedMotion();
  const { mutate } = useSync();
  const upsert = useUpsertPersonalRecord();
  const removePersonal = useDeletePersonalRecord();
  const ledger = usePersonalLedger();
  const viewerId = useViewerId();
  const loanNets = useSyncedLoanNets(
    viewerId,
    ledger.loans.flatMap((loan) => (loan.synced ? [loan.synced] : [])),
  );

  const state = context.state;
  const [ringOn, setRingOn] = useState(true);
  const [removed, setRemoved] = useState<SavedState | null>(null);
  const [history, setHistory] = useState<UndoEntry[]>([]);
  const [line, setLine] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(false);
  // The write the group expense is saved with; a move to another group replaces it.
  const baseRef = useRef<AgentExpenseWrite | null>(groupWrite);
  // The write each move left behind, so undoing the move can take it back.
  const baseBeforeMove = useRef<(AgentExpenseWrite | null)[]>([]);
  const pendingBase = useRef<AgentExpenseWrite | null>(null);
  // A move that wrote its destination but could not remove the source: the retry resumes it.
  const moveProgress = useRef<MoveProgress | null>(null);
  // The id a move's new entry gets, stable per source and target until the move completes.
  const moveIds = useRef(new Map<string, string>());
  // The full personal record read just before a delete hid it, for Restore.
  const removedCarried = useRef<Readonly<Record<string, unknown>> | undefined>(undefined);

  useEffect(() => {
    const timer = setTimeout(() => setRingOn(false), UNDO_RING_MS);
    return () => clearTimeout(timer);
  }, []);

  // A hand-off the panel did (a lend that became a loan, a duplicate removed) becomes one more undo step.
  const seenExternal = useRef<UndoEntry | null>(null);
  useEffect(() => {
    if (externalEntry && externalEntry !== seenExternal.current) {
      seenExternal.current = externalEntry;
      setHistory((h) => pushHistory(h, externalEntry));
    }
  }, [externalEntry]);

  // The form that split this entry or moved it to a trip leaves a snapshot
  // behind; back on this screen, that move becomes one more undo step.
  useFocusEffect(
    useCallback(() => {
      const move = lastRememberedMove();
      if (!move || state.kind !== 'personal' || move.personalId !== state.id) return;
      forgetMove();
      setHistory((h) => pushHistory(h, { kind: 'handoff', previous: state, snapshot: move }));
    }, [state]),
  );

  const amountOf = (s: SavedState): string => format(money(s.amount, s.currency), { locale });

  const writeGroup = useCallback(
    (groupId: string, write: ReturnType<typeof toGroupWrite>, create: boolean) =>
      mutate(create ? MutationKind.ExpenseCreate : MutationKind.ExpenseUpdate, groupId, {
        ...serialiseExpense(write),
        expenseId: write.expenseId,
      }),
    [mutate],
  );

  const persist = useCallback(
    async (next: SavedState): Promise<boolean> => {
      try {
        if (next.kind === 'personal') {
          await upsert.mutateAsync({
            recordId: next.id,
            recordKind: 'txn',
            data: toPersonalData(next),
          });
        } else {
          const base = baseRef.current;
          if (!base || !next.groupId) return false;
          await writeGroup(next.groupId, toGroupWrite(base, next), false);
        }
        controls.replaceSaved(next);
        return true;
      } catch {
        return false;
      }
    },
    // The mutation hooks are stable per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controls, writeGroup],
  );

  const undoDeps: UndoDeps = useMemo(
    () => ({
      deleteGroupExpense: (groupId, expenseId) =>
        mutate(MutationKind.ExpenseDelete, groupId, { expenseId }),
      restoreGroupExpense: (groupId, expenseId) =>
        mutate(MutationKind.ExpenseRestore, groupId, { expenseId }),
      deletePersonal: (recordId) => removePersonal.mutateAsync(recordId),
      upsertPersonal: (input) => upsert.mutateAsync(input),
      persist,
      newId: () => randomUUID(),
      sharedLoanExpense: (loanId) => {
        const loan = ledger.loans.find((l) => l.id === loanId);
        const link = loan?.synced;
        return link
          ? {
              groupId: link.groupId,
              expenseId: link.expenseId,
              settled: sharedDebtSettled(loan, loanNets, ledger.loans),
            }
          : null;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mutate, persist, ledger.loans, loanNets],
  );

  const carriedFor = (s: SavedState): Readonly<Record<string, unknown>> | undefined =>
    s.kind === 'personal' ? ledger.txns.find((txn) => txn.id === s.id)?.carried : undefined;

  const doMove: TypedDeps['move'] = useCallback(
    async (plan: MovePlan, from: SavedState): Promise<boolean> => {
      // The base is switched only once both writes went through, so a half-done
      // move that is retried (or abandoned) leaves the old base in place.
      pendingBase.current = baseRef.current;
      return runMove(moveProgress, plan, from, {
        writeDestination: async (p) => {
          if (p.kind === 'toGroup') await writeGroup(p.groupId, p.write, true);
          else await upsert.mutateAsync({ recordId: p.recordId, recordKind: 'txn', data: p.data });
        },
        removeSource: async (source) => {
          const r = await undoSaved(source, undoDeps);
          if (!r.ok) throw new Error('could not remove the original');
        },
        removeDestination: async (d) => {
          if (d.kind === 'group') await undoDeps.deleteGroupExpense(d.groupId, d.id);
          else await undoDeps.deletePersonal(d.id);
        },
        completed: (p) => {
          baseRef.current = p.kind === 'toGroup' ? p.write : null;
          for (const key of [...moveIds.current.keys()]) {
            if (key.startsWith(`${from.id}>`)) moveIds.current.delete(key);
          }
        },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [writeGroup, undoDeps],
  );

  const moveIdFor = (target: string | null): string => {
    const key = `${state.id}>${target ?? 'personal'}`;
    let id = moveIds.current.get(key);
    if (!id) {
      id = randomUUID();
      moveIds.current.set(key, id);
    }
    return id;
  };

  const placesAndCategories = useMemo(() => {
    const places: string[] = [];
    for (const txn of ledger.txns) {
      if (txn.place && !places.includes(txn.place)) places.push(txn.place);
      if (places.length >= 40) break;
    }
    return { places, categories: Object.keys(t.categories) };
  }, [ledger.txns, t.categories]);

  const settle = (result: TypedResult, carried?: Readonly<Record<string, unknown>>): void => {
    switch (result.kind) {
      case 'corrected': {
        const entry = historyEntryFor(result, carried);
        if (entry) setHistory((h) => pushHistory(h, entry));
        if (result.answers && result.answers.length > 0) {
          controls.addFilled(result.answers.map(filledBy));
        }
        setLine(result.line);
        setNotice(null);
        controls.replaceSaved(result.next);
        if (result.moved) {
          baseBeforeMove.current.push(pendingBase.current);
          controls.stop();
        }
        for (const field of result.fields) {
          // The payer is not a reported field (the event's words are a fixed list).
          if (field === 'payerMemberId') continue;
          onEvent?.({
            name: 'assistant_correction',
            field: field === 'amountMinor' ? 'amount' : field === 'groupId' ? 'group' : field,
            path: result.path,
          });
        }
        setTyping(false);
        return;
      }
      case 'answered': {
        const entry = historyEntryFor(result);
        if (entry) setHistory((h) => pushHistory(h, entry));
        controls.addFilled(result.answers.map(filledBy));
        setLine(c.updated);
        setNotice(null);
        setTyping(false);
        return;
      }
      case 'undo':
        void doUndo();
        return;
      case 'undoAnswer':
        void doUndoLast();
        return;
      case 'unchanged':
        setNotice(c.unchanged);
        return;
      case 'failed':
        setNotice(c.couldNotChange);
        return;
      case 'offline':
        setNotice(c.needsConnection);
        return;
      case 'unusable':
        setNotice(c.couldNotUse);
        return;
    }
  };

  const contextFor = (text: string, online: boolean) => ({
    text,
    state,
    today,
    locale,
    local,
    strings: c,
    online,
    newId: moveIdFor,
    places: placesAndCategories.places,
    categories: placesAndCategories.categories,
    categoryLabel: (id: string) => (t.categories as Record<string, string>)[id] ?? id,
  });

  const submit = async (text: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    // Read before a move deletes the record: its unknown fields must survive an undo.
    const carried = carriedFor(state);
    try {
      const online = await checkOnline();
      const result = await runTypedMessage(contextFor(text, online), {
        persist,
        move: doMove,
        send: (message) =>
          sendVoiceTranscript({
            transcript: message,
            groupId: state.groupId,
            locale,
            today,
            savedExpense: { id: state.id, kind: state.kind, groupId: state.groupId },
          }),
      });
      settle(result, carried);
    } finally {
      setBusy(false);
    }
  };

  // The follow-up composer hands the agent's reply here, so a typed answer there
  // is applied by the same executor (amount, date, move, delete, undo history).
  const applyModelResponse = async (response: VoiceAgentResponse): Promise<TypedResult> => {
    const carried = carriedFor(state);
    const result = await applyAgentResponse(
      contextFor('', true),
      {
        persist,
        move: doMove,
        send: async () => ({ kind: 'error' }),
      },
      response,
    );
    settle(result, carried);
    return result;
  };
  const executorRef = useRef(applyModelResponse);
  useEffect(() => {
    executorRef.current = applyModelResponse;
  });
  useEffect(
    () => controls.registerExecutor((response) => executorRef.current(response)),
    [controls],
  );

  // An inline sheet (split with, move to a trip, split by item) moves the
  // expense through this bar's own machinery: the same resumable `runMove`, the
  // same write base switch and the same undo step a typed move leaves.
  const inlineMove = async (plan: MovePlan, from: SavedState, line?: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    // Read before the move deletes the record: its unknown fields must survive an undo.
    const carried = carriedFor(from);
    try {
      if (!(await doMove(plan, from))) {
        setNotice(c.couldNotChange);
        return false;
      }
      settle(
        {
          kind: 'corrected',
          previous: from,
          next: plan.next,
          line: line ?? correctionLine(plan.next, ['groupId'], contextFor('', true)),
          fields: ['groupId'],
          path: 'device',
          moved: true,
        },
        carried,
      );
      return true;
    } finally {
      setBusy(false);
    }
  };
  const moverRef = useRef(inlineMove);
  useEffect(() => {
    moverRef.current = inlineMove;
  });
  useEffect(
    () => controls.registerMover((plan, from, line) => moverRef.current(plan, from, line)),
    [controls],
  );

  // After a hand-off the expense is already gone from where it was: Undo takes the hand-off back.
  const top = history[history.length - 1]?.kind;
  const handedOffNow = top === 'lend' || top === 'duplicate';

  async function doUndo(): Promise<void> {
    if (busy) return;
    hapticLight();
    if (handedOffNow) {
      await doUndoLast();
      return;
    }
    setBusy(true);
    try {
      // Read before the delete hides the record: Restore needs every field of it.
      const carried = carriedFor(state);
      // A move that wrote its destination but not the removal: take that copy out too.
      const stranded = moveProgress.current;
      if (stranded && stranded.sourceId === state.id && stranded.destWritten) {
        try {
          const d = stranded.destination;
          if (d.kind === 'group') await undoDeps.deleteGroupExpense(d.groupId, d.id);
          else await undoDeps.deletePersonal(d.id);
          moveProgress.current = null;
        } catch {
          setNotice(c.couldNotUndo);
          return;
        }
      }
      const out = await undoSaved(state, undoDeps);
      if (!out.ok) {
        setNotice(c.couldNotUndo);
        return;
      }
      removedCarried.current = carried;
      setRemoved(out.removed);
      setLine(null);
      setTyping(false);
      controls.stop();
      onEvent?.({ name: 'assistant_undo', what: 'expense' });
    } finally {
      setBusy(false);
    }
  }

  async function doUndoLast(): Promise<void> {
    if (busy) return;
    hapticLight();
    setBusy(true);
    try {
      const undoingMove = history[history.length - 1]?.kind === 'move';
      const attempt = await undoLastDetailed(history, undoDeps);
      if (!attempt.ok) {
        setNotice(attempt.refused === 'settled' ? c.undoLoanSettled : c.couldNotUndo);
        return;
      }
      const done = attempt;
      setHistory(done.rest);
      if (undoingMove) baseRef.current = baseBeforeMove.current.pop() ?? null;
      if (done.outcome.what === 'answer') controls.popFilled();
      controls.replaceSaved(done.outcome.state);
      setLine(done.rest.length > 0 ? c.undone : null);
      setNotice(null);
      onEvent?.({
        name: 'assistant_undo',
        what: done.outcome.what === 'correction' ? 'answer' : done.outcome.what,
      });
    } finally {
      setBusy(false);
    }
  }

  async function doRestore(): Promise<void> {
    if (!removed || busy) return;
    setBusy(true);
    try {
      const out = await restoreSaved(removed, undoDeps, removedCarried.current);
      if (!out.ok) {
        setNotice(c.couldNotUndo);
        return;
      }
      controls.replaceSaved(out.state);
      setRemoved(null);
      setNotice(null);
      setLine(c.restored);
    } finally {
      setBusy(false);
    }
  }

  if (removed) {
    return (
      <View style={{ gap: theme.spacing.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <Text tone="muted" style={{ flex: 1 }} numberOfLines={2}>
            {fill(c.removed, { amount: amountOf(removed), description: removed.description })}
          </Text>
          <Link
            label={c.restore}
            brand
            disabled={busy}
            accessibilityLabel={fill(c.restoreA11y, {
              amount: amountOf(removed),
              description: removed.description,
            })}
            onPress={() => void doRestore()}
          />
        </View>
        {notice ? (
          <Text variant="caption" tone="muted">
            {notice}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ gap: theme.spacing.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <Ionicons name="checkmark-circle" size={iconSize.base} color={theme.color.brand} />
        <Text style={{ flex: 1 }} numberOfLines={2}>
          {context.headline}
        </Text>
        <Link
          label={c.undo}
          brand
          disabled={busy}
          accessibilityLabel={fill(c.undoA11y, {
            amount: amountOf(state),
            description: state.description,
          })}
          onPress={() => void doUndo()}
        >
          {ringOn ? (
            <UndoRing color={theme.color.brand} track={theme.color.border} still={reduceMotion} />
          ) : null}
        </Link>
      </View>

      {line ? (
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Text variant="caption" tone="muted" style={{ flex: 1 }}>
            {line}
          </Text>
          {history.length > 0 ? (
            <Link label={c.undo} disabled={busy} onPress={() => void doUndoLast()} />
          ) : null}
        </View>
      ) : null}

      {typing ? (
        <VoiceTypedAnswer autoFocus onSubmit={(text) => void submit(text)} />
      ) : (
        <View style={{ flexDirection: 'row' }}>
          <Link
            label={c.change}
            onPress={() => {
              controls.hold();
              setTyping(true);
            }}
          />
        </View>
      )}

      {notice ? (
        <Text variant="caption" tone="muted">
          {notice}
        </Text>
      ) : null}
    </View>
  );
}
