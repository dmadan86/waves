/**
 * The back half of "Split with friends…" (see `PersonalMoveSheet`): the group
 * expense is queued first and the Personal entry goes only after the server has
 * accepted it, so a failure never loses the entry.
 */
import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable } from 'react-native';
import { MutationKind, personalScope } from '@waves/core';
import { Card, Text, useTheme } from '@waves/ui';

import { uploadExpenseReceipt } from '@/data/api';
import { pickedFromUrl } from '@/data/moveSpace';
import { useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { personalReceiptUrl, removePersonalReceipt } from '@/lib/personalReceipt';
import {
  afterCarryFailure,
  moveStep,
  patchPendingMove,
  readPendingMoves,
  type PendingMove,
} from '@/lib/pendingMoves';
import { useSync } from '@/sync';

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
