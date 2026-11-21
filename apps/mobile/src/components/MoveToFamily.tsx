/**
 * "Move to family": from a saved Personal expense, move it into one of the
 * viewer's Share-it groups. The group expense is queued first (pooled by the
 * sync layer: nobody owes anybody) and the personal entry goes only after that
 * write is queued, so a failure never loses the entry.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { randomUUID } from 'expo-crypto';
import { isPoolGroup, MutationKind } from '@waves/core';
import { Card, iconSize, Text, useTheme } from '@waves/ui';

import { useAllGroupMembers, useGroups } from '@/data/hooks';
import { useDeletePersonalRecord } from '@/data/personal';
import { serialiseExpense } from '@/data/serialiseExpense';
import { groupLabel, isViewer, type GroupRow } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import {
  addPendingMove,
  moveOutcome,
  readPendingMoves,
  writePendingMoves,
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
        expenseId: randomUUID(),
      });
      // The private copy goes only once the server has accepted the group
      // expense (PendingMoveCleanup); a refused write keeps the entry.
      await addPendingMove({ cmid, personalId: entry.id });
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
 * Finishes "Move to family": deletes each moved private entry once its group
 * expense has left the sync queue, and forgets the move (keeping the entry)
 * when the server refused it. Mounted once under the tabs.
 */
export function PendingMoveCleanup(): null {
  const { queue } = useSync();
  const remove = useDeletePersonalRecord();
  const running = useRef(false);
  useEffect(() => {
    if (running.current) return;
    running.current = true;
    void (async () => {
      try {
        const moves = await readPendingMoves();
        if (moves.length === 0) return;
        const left: PendingMove[] = [];
        for (const move of moves) {
          const outcome = moveOutcome(move, queue);
          if (outcome === 'wait') left.push(move);
          else if (outcome === 'delete') {
            // A failed delete is tried again next time the queue changes.
            await remove.mutateAsync(move.personalId).catch(() => left.push(move));
          }
        }
        if (left.length !== moves.length) await writePendingMoves(left);
      } finally {
        running.current = false;
      }
    })();
  }, [queue, remove]);
  return null;
}
