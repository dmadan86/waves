/**
 * Move an expense (or company entry) to another space: the same amount, date, note
 * and bill are re-created there, then the original is removed.
 *
 * Not one server call: the app writes through an offline queue, so this queues the
 * create first, waits for it to land (retrying quietly), and only then removes the
 * original. The new row has a caller-chosen id, so a retry after a failure re-creates
 * nothing twice, and a failure before the delete leaves the original untouched.
 */

import { randomUUID } from 'expo-crypto';
import { File, Paths } from 'expo-file-system';

import {
  COMPANY_EXPENSE_CATEGORIES,
  computeShares,
  MutationKind,
  rowsFor,
  SyncTable,
  type SplitParams,
} from '@waves/core';

import { useAllGroupMembers } from '@/data/hooks';
import { attachCompanyPhoto } from '@/data/companyEntries';
import { uploadExpenseReceipt } from '@/data/api';
import { serialiseExpense } from '@/data/serialiseExpense';
import { isViewer, type GroupRow } from '@/data/types';
import { useViewerId } from '@/lib/auth';
import type { PickedImage } from '@/lib/image';
import { mapMove, mayRemoveOriginal } from '@/lib/voiceSpace';
import { syncEngine, useSync } from '@/sync';

const EQUAL: SplitParams = { kind: 'equal' };
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface MoveArgs {
  from: { kind: 'group' | 'company'; groupId: string; id: string };
  to: GroupRow;
  amount: bigint;
  currency: string;
  /** yyyy-mm-dd */
  date: string;
  note: string;
  category: string | null;
  /** Resolves the bill photos' signed URLs, only called when the move starts. */
  receiptUrls: () => Promise<readonly string[]>;
  /** Who pays and shares in the target (see `planMove`). */
  plan: { payerId: string; participantIds: string[] };
  /** The id the new row takes; keep it across retries so nothing is duplicated. */
  newId: string;
}

async function pickedFromUrl(url: string): Promise<PickedImage> {
  const file = await File.downloadFileAsync(url, new File(Paths.cache, `move-${randomUUID()}.jpg`));
  try {
    return { base64: await file.base64(), mimeType: 'image/jpeg', uri: file.uri };
  } finally {
    try {
      file.delete();
    } catch {
      // The cache is swept anyway.
    }
  }
}

/** Waits for a queued create to reach the server; throws only if the server refused it. */
async function created(clientMutationId: string, groupId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await syncEngine.flush({ groupIds: [groupId] }).catch(() => undefined);
    const queued = syncEngine.getState().queue.find((m) => m.clientMutationId === clientMutationId);
    if (!queued) return true;
    if (queued.rejection) {
      await syncEngine.discard(clientMutationId).catch(() => undefined);
      throw new Error('move refused');
    }
    await sleep(800 * (attempt + 1));
  }
  return false;
}

/** Is the new row already on the server, or already queued? A retry then resumes instead of re-creating. */
function alreadyThere(args: MoveArgs): { landed: boolean; queuedId: string | null } {
  const { mirror, queue } = syncEngine.getState();
  const table = args.to.type === 'company' ? SyncTable.CompanyEntries : SyncTable.Expenses;
  if (rowsFor(mirror, table, args.to.id).some((row) => row.id === args.newId))
    return { landed: true, queuedId: null };
  const queued = queue.find((m) => {
    const payload = m.payload as { expenseId?: string; entryId?: string };
    return (
      m.groupId === args.to.id &&
      !m.rejection &&
      (payload.expenseId === args.newId || payload.entryId === args.newId)
    );
  });
  return { landed: false, queuedId: queued?.clientMutationId ?? null };
}

export function useMoveToSpace(): (args: MoveArgs) => Promise<void> {
  const { mutate } = useSync();
  const viewerId = useViewerId();
  const everyMember = useAllGroupMembers();
  return async (args) => {
    const members = everyMember.filter((m) => m.group_id === args.to.id && !m.left_at);
    const me = members.find((m) => isViewer(m, viewerId));
    if (!me) throw new Error('not a member of the target space');
    const carried = mapMove(
      {
        amount: args.amount,
        currency: args.currency,
        date: args.date,
        note: args.note,
        category: args.category,
      },
      args.to,
    );
    // A retry after a partial failure resumes: the copy may already be there.
    const there = alreadyThere(args);
    let landed = there.landed;
    if (!landed) {
      let cid = there.queuedId;
      if (!cid && carried.kind === 'company') {
        const category = (COMPANY_EXPENSE_CATEGORIES as readonly string[]).includes(
          carried.category ?? '',
        )
          ? carried.category
          : 'other';
        cid = await mutate(MutationKind.CompanyEntryCreate, args.to.id, {
          entryId: args.newId,
          memberId: me.id,
          entryKind: 'expense',
          data: {
            amount: carried.amount.toString(),
            category,
            calcMode: 'typed',
            occurredOn: carried.date,
            note: carried.note,
          },
        });
      } else if (!cid) {
        const shares = computeShares({
          amount: carried.amount,
          currency: carried.currency,
          params: EQUAL,
          participants: args.plan.participantIds,
          seed: args.newId,
        });
        cid = await mutate(MutationKind.ExpenseCreate, args.to.id, {
          ...serialiseExpense({
            description: carried.note,
            category: carried.category,
            expenseDate: carried.date,
            currency: carried.currency,
            amount: carried.amount,
            splitParams: EQUAL,
            participants: args.plan.participantIds,
            payers: { [args.plan.payerId]: carried.amount },
            expectedShares: Object.fromEntries(shares),
          }),
          expenseId: args.newId,
        });
      }
      landed = await created(cid, args.to.id);
    }
    // The original goes only once the copy is confirmed on the server.
    if (!mayRemoveOriginal(landed)) throw new Error('copy not confirmed yet');

    // The bill goes next, to a row the server already has.
    const urls = await args.receiptUrls();
    for (const [index, url] of urls.entries()) {
      const picked = await pickedFromUrl(url);
      if (carried.kind === 'company') await attachCompanyPhoto(args.to.id, args.newId, picked);
      else if (index === 0)
        await uploadExpenseReceipt({
          groupId: args.to.id,
          expenseId: args.newId,
          base64: picked.base64,
          mimeType: picked.mimeType,
        });
    }

    if (args.from.kind === 'company')
      await mutate(MutationKind.CompanyEntryVoid, args.from.groupId, {
        entryId: args.from.id,
        reason: 'moved',
      });
    else await mutate(MutationKind.ExpenseDelete, args.from.groupId, { expenseId: args.from.id });
    void syncEngine.flush({ groupIds: [args.from.groupId, args.to.id] }).catch(() => undefined);
  };
}
