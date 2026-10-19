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
import { randomUUID } from 'expo-crypto';
import { Pressable, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { MutationKind, format, money } from '@waves/core';
import { iconSize, Text, useTheme } from '@waves/ui';

import type { SavedBarControls } from '@/components/VoiceFollowUps';
import { VoiceTypedAnswer } from '@/components/VoiceTypedAnswer';
import {
  useDeletePersonalRecord,
  useUpsertPersonalRecord,
  usePersonalLedger,
} from '@/data/personal';
import { serialiseExpense } from '@/data/serialiseExpense';
import { fill, useStrings } from '@/i18n';
import {
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
  undoLast,
  undoSaved,
  type UndoDeps,
  type UndoEntry,
} from '@/lib/assistantUndo';
import { filledBy, toGroupWrite, toPersonalData, type SavedState } from '@/lib/followUpApply';
import { useReducedMotion } from '@/lib/reducedMotion';
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
      readonly field: string;
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
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mutate, persist],
  );

  const carriedFor = (s: SavedState): Readonly<Record<string, unknown>> | undefined =>
    s.kind === 'personal' ? ledger.txns.find((txn) => txn.id === s.id)?.carried : undefined;

  const doMove: TypedDeps['move'] = useCallback(
    async (plan: MovePlan, from: SavedState): Promise<boolean> => {
      try {
        // Save the new entry first, then remove the old one: nothing is lost if the second step fails.
        pendingBase.current = baseRef.current;
        if (plan.kind === 'toGroup') {
          await writeGroup(plan.groupId, plan.write, true);
          baseRef.current = plan.write;
        } else {
          await upsert.mutateAsync({ recordId: plan.recordId, recordKind: 'txn', data: plan.data });
          baseRef.current = null;
        }
        await undoSaved(from, undoDeps).then((r) => {
          if (!r.ok) throw new Error('could not remove the original');
        });
        return true;
      } catch {
        return false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [writeGroup, undoDeps],
  );

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
        setLine(result.line);
        setNotice(null);
        controls.replaceSaved(result.next);
        if (result.moved) {
          baseBeforeMove.current.push(pendingBase.current);
          controls.stop();
        }
        for (const field of result.fields) {
          onEvent?.({
            name: 'assistant_correction',
            field:
              field === 'amountMinor'
                ? 'amount'
                : field === 'groupId'
                  ? 'group'
                  : field === 'payerMemberId'
                    ? 'payer'
                    : field,
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

  const submit = async (text: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    // Read before a move deletes the record: its unknown fields must survive an undo.
    const carried = carriedFor(state);
    try {
      const online = await checkOnline();
      const result = await runTypedMessage(
        {
          text,
          state,
          today,
          locale,
          local,
          strings: c,
          online,
          newId: () => randomUUID(),
          places: placesAndCategories.places,
          categories: placesAndCategories.categories,
          categoryLabel: (id) => (t.categories as Record<string, string>)[id] ?? id,
        },
        {
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
        },
      );
      settle(result, carried);
    } finally {
      setBusy(false);
    }
  };

  // After a hand-off the expense is already gone from where it was: Undo takes the hand-off back.
  const top = history[history.length - 1]?.kind;
  const handedOffNow = top === 'lend' || top === 'duplicate';

  async function doUndo(): Promise<void> {
    if (busy) return;
    if (handedOffNow) {
      await doUndoLast();
      return;
    }
    setBusy(true);
    try {
      const out = await undoSaved(state, undoDeps);
      if (!out.ok) {
        setNotice(c.couldNotUndo);
        return;
      }
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
    setBusy(true);
    try {
      const undoingMove = history[history.length - 1]?.kind === 'move';
      const done = await undoLast(history, undoDeps);
      if (!done) {
        setNotice(c.couldNotUndo);
        return;
      }
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
      const out = await restoreSaved(removed, undoDeps, carriedFor(removed));
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
