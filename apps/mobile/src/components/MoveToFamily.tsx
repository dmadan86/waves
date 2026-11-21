/**
 * "Move to family": from a saved Personal expense, move it into one of the
 * viewer's Share-it groups. The group expense is queued first (pooled by the
 * sync layer: nobody owes anybody) and the personal entry goes only after that
 * write is queued, so a failure never loses the entry.
 */
import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { randomUUID } from 'expo-crypto';
import { isPoolGroup, MutationKind, personalScope } from '@waves/core';
import { Card, iconSize, Text, useTheme } from '@waves/ui';

import { useAllGroupMembers, useGroups } from '@/data/hooks';
import { uploadExpenseReceipt } from '@/data/api';
import { pickedFromUrl } from '@/data/moveSpace';
import { serialiseExpense } from '@/data/serialiseExpense';
import { groupLabel, isViewer, type GroupRow } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { personalReceiptUrl, removePersonalReceipt } from '@/lib/personalReceipt';
import {
  addPendingMove,
  afterCarryFailure,
  moveStep,
  patchPendingMove,
  readPendingMoves,
  type PendingMove,
} from '@/lib/pendingMoves';
import { useSync } from '@/sync';

export interface MoveEntry {
  readonly id: string;
  readonly amount: bigint;
  readonly currency: string;
  readonly date: string;
  readonly note: string | null;
  readonly category: string | null;
  /** The Personal bill photo's key, carried to the group expense. */
  readonly receiptKey?: string | null;
}

export function MoveToFamily({ entry, onMoved }: { entry: MoveEntry; onMoved: () => void }) {
  const theme = useTheme();
  const { t } = useStrings();
  const { mutate, flush } = useSync();
  const viewerId = useViewerId();
  const groups = useGroups();
  const everyone = useAllGroupMembers();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pooled households the viewer is in, in the entry's currency (a rupee entry
  // is never moved into a dollar pot).
  const targets = groups.data.filter(
    (group) =>
      isPoolGroup(group) &&
      !group.archived_at &&
      group.default_currency === entry.currency &&
      everyone.some((m) => m.group_id === group.id && isViewer(m, viewerId) && !m.left_at),
  );
  if (targets.length === 0) return null;

  const move = async (group: GroupRow): Promise<void> => {
    const me = everyone.find((m) => m.group_id === group.id && isViewer(m, viewerId) && !m.left_at);
    if (!me || busy) return;
    setBusy(group.id);
    setError(null);
    try {
      const expenseId = randomUUID();
      const cmid = await mutate(MutationKind.ExpenseCreate, group.id, {
        ...serialiseExpense({
          description: entry.note ?? '',
          category: entry.category,
          expenseDate: entry.date,
          currency: entry.currency,
          amount: entry.amount,
          splitParams: { kind: 'equal' },
          participants: [me.id],
          payers: { [me.id]: entry.amount },
        }),
        expenseId,
      });
      // The private copy goes only once the server has accepted the group
      // expense (PendingMoveCleanup); a refused write keeps the entry.
      await addPendingMove({
        cmid,
        personalId: entry.id,
        ...(entry.receiptKey ? { receiptKey: entry.receiptKey, groupId: group.id, expenseId } : {}),
      });
      void flush([group.id]);
      onMoved();
    } catch (caught) {
      setError(friendlyError(caught, t.household.moveFailed, 'household.move'));
      setBusy(null);
    }
  };

  const rowStyle = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.spacing.md,
    minHeight: 56,
  };
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Card padded={false} style={{ paddingHorizontal: theme.spacing.lg }}>
        <View style={rowStyle} accessible accessibilityState={{ selected: true }}>
          <Ionicons name="wallet-outline" size={iconSize.lg} color={theme.color.brand} />
          <Text style={{ flex: 1, fontSize: 16, fontWeight: '700' }}>{t.household.moveKeep}</Text>
          <Ionicons name="checkbox" size={iconSize.xl} color={theme.color.brand} />
        </View>
        {targets.map((group) => {
          const label = fill(t.household.moveTo, { name: groupLabel(group, []) });
          return (
            <Pressable
              key={group.id}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ busy: busy === group.id, disabled: busy !== null }}
              disabled={busy !== null}
              onPress={() => void move(group)}
              style={[
                rowStyle,
                { borderTopWidth: 1, borderTopColor: theme.color.border, opacity: busy ? 0.6 : 1 },
              ]}
            >
              <Ionicons name="people-outline" size={iconSize.lg} color={theme.color.positive} />
              <Text style={{ flex: 1, fontSize: 16, fontWeight: '700' }}>{label}</Text>
              <Ionicons name="square-outline" size={iconSize.xl} color={theme.color.textFaint} />
            </Pressable>
          );
        })}
      </Card>
      <Text variant="caption" tone="muted">
        {t.household.movePrivacy}
      </Text>
      {error ? (
        <Text variant="caption" tone="negative">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Finishes "Move to family". Per move: wait for the group expense to be accepted,
 * copy the bill photo onto it (retried with backoff, then parked as failed with
 * the entry and photo kept), queue the Personal delete, and drop the source photo
 * only once the server has acknowledged that delete. A refused write keeps the
 * entry. Every list change is a read-modify-write on a fresh read. Mounted once
 * under the tabs; re-checked on queue changes, on a timer and on foreground.
 */
export function PendingMoveCleanup(): null {
  const { queue, mutate } = useSync();
  const viewerId = useViewerId();
  const running = useRef(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') setTick((n) => n + 1);
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (running.current) return;
    running.current = true;
    void (async () => {
      try {
        const q = queue;
        const owner = viewerId;
        for (const move of await readPendingMoves()) {
          const step = moveStep(move, q, Date.now());
          if (step === 'idle') continue;
          if (step === 'drop') await patchPendingMove(move.cmid, null);
          else if (step === 'finish') {
            if (move.receiptKey && move.carried) void removePersonalReceipt(owner, move.receiptKey);
            await patchPendingMove(move.cmid, null);
          } else if (step === 'carry') {
            try {
              const url = await personalReceiptUrl(move.receiptKey);
              if (!url || !move.groupId || !move.expenseId) throw new Error('no photo url');
              const picked = await pickedFromUrl(url);
              await uploadExpenseReceipt({
                groupId: move.groupId,
                expenseId: move.expenseId,
                base64: picked.base64,
                mimeType: picked.mimeType,
              });
              await patchPendingMove(move.cmid, { ...move, carried: true });
            } catch {
              await patchPendingMove(move.cmid, afterCarryFailure(move));
            }
          } else if (owner) {
            // Queue the Personal delete; the move keeps its id until it is acknowledged.
            try {
              const deleteCmid = await mutate(MutationKind.PersonalDelete, personalScope(owner), {
                recordId: move.personalId,
              });
              await patchPendingMove(move.cmid, { ...move, deleteCmid });
            } catch {
              // Tried again on the next pass.
            }
          }
        }
      } finally {
        running.current = false;
      }
    })();
  }, [queue, viewerId, tick, mutate]);
  return null;
}

/**
 * On a Personal entry whose move could not carry its bill photo: say so, and
 * offer to try again or to move without the photo. The entry is untouched.
 */
export function MoveReceiptNotice({ personalId }: { personalId: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  const [move, setMove] = useState<PendingMove | null>(null);
  useEffect(() => {
    void readPendingMoves().then((moves) =>
      setMove(moves.find((m) => m.personalId === personalId && m.failed) ?? null),
    );
  }, [personalId]);
  if (!move) return null;
  const act = (next: PendingMove): void => {
    setMove(null);
    void patchPendingMove(move.cmid, next);
  };
  const link = { minHeight: 44, justifyContent: 'center' as const };
  return (
    <Card style={{ gap: theme.spacing.xs }}>
      <Text style={{ fontWeight: '700' }}>{t.household.moveReceiptFailed}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => act({ ...move, failed: false, tries: 0, nextAt: 0 })}
        style={link}
      >
        <Text tone="brand" style={{ fontWeight: '700' }}>
          {t.household.moveReceiptRetry}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => act({ ...move, failed: false, carried: true })}
        style={link}
      >
        <Text tone="brand" style={{ fontWeight: '700' }}>
          {t.household.moveWithoutReceipt}
        </Text>
      </Pressable>
    </Card>
  );
}
