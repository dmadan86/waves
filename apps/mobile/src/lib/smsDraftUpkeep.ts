/**
 * The two jobs that keep local SMS drafts honest after they are written.
 *
 * 1. **The one-time move.** Before drafts stayed on the phone, every SMS
 *    draft was a synced capture, and those are still on the server — which is
 *    exactly how an iPad came to show a phone's bank messages. On the Android
 *    phone, once, after its first sync this session: each open, unassigned
 *    capture whose `parsed.source` is `'sms'` is copied into the local store
 *    (as it was — no body is invented; an inbox draft never had one) and then
 *    removed from the server with the ordinary `capture.delete`, so every
 *    other device drops it on its next pull. Captures already turned into
 *    expenses are `assigned` and are not touched.
 *
 *    It is safe to interrupt: the copy is keyed by the capture's own id and
 *    will not write twice, and the delete is only queued after the copy is on
 *    disk — so a kill between the two leaves the draft in both places, and the
 *    next run finishes the job. It is marked done only when every capture it
 *    found went through.
 *
 * 2. **Held drafts.** A draft placed in a group is hidden from Review but not
 *    deleted until its expense is on the server (`smsLocalDrafts.heldOutcome`).
 *    If the expense is refused and discarded, the draft comes back.
 *
 * Both are plain functions with everything they touch handed in, so they are
 * tested without a device; `useSmsDraftUpkeep.ts` is the React wiring.
 */

import type { MirrorCapture, QueuedMutation } from '@waves/core';

import type { DraftCache } from './smsDraftCache';
import { capturesToMove, draftRowFromCapture, heldOutcome } from './smsLocalDrafts';

export interface MoveInput {
  readonly ownerId: string;
  /** This owner's captures, server rows with the queue replayed on top. */
  readonly captures: readonly MirrorCapture[];
  readonly drafts: DraftCache;
  /** Queue the server copy's removal — `capture.delete`, straight to the queue. */
  readonly deleteServerCapture: (captureId: string) => Promise<void>;
  readonly isDone: (ownerId: string) => Promise<boolean>;
  readonly markDone: (ownerId: string) => Promise<void>;
}

export interface MoveResult {
  /** Captures copied and queued for removal this run. */
  readonly moved: number;
  /** Whether the move is now recorded as finished for this account. */
  readonly done: boolean;
}

/** Take this account's synced SMS drafts off the server and onto this phone. */
export async function moveSyncedSmsDrafts(input: MoveInput): Promise<MoveResult> {
  if (!input.ownerId) return { moved: 0, done: false };
  if (await input.isDone(input.ownerId)) return { moved: 0, done: true };

  let moved = 0;
  let failed = false;
  for (const capture of capturesToMove(input.captures)) {
    if (capture.owner_user_id !== input.ownerId) continue;
    try {
      // A false here means the id is already known on this phone — a copy
      // from an interrupted run, or a draft already used or dismissed. Either
      // way the server copy has no business staying.
      await input.drafts.put(input.ownerId, draftRowFromCapture(capture));
      await input.deleteServerCapture(capture.id);
      moved += 1;
    } catch {
      // Left for the next run; nothing is marked done while one is missing.
      failed = true;
    }
  }
  if (failed) return { moved, done: false };
  await input.markDone(input.ownerId);
  return { moved, done: true };
}

export interface ReconcileInput {
  readonly ownerId: string;
  readonly drafts: DraftCache;
  /** Is this expense id in the mirror — confirmed by the server? */
  readonly isConfirmed: (expenseId: string) => boolean;
  readonly queue: readonly QueuedMutation[];
  /** Changes with every completed sync (`lastSyncedAt`). */
  readonly syncMark: string | null;
  /**
   * Drafts seen with their expense missing, and the sync mark at the time.
   * Kept by the caller across runs; a draft is only reopened once it is still
   * missing after a later sync has completed.
   */
  readonly missing: Map<string, string | null>;
}

/** Remove drafts whose expense landed; reopen ones whose expense was discarded. */
export async function reconcileHeld(input: ReconcileInput): Promise<void> {
  if (!input.ownerId) return;
  const held = await input.drafts.heldDrafts(input.ownerId);
  const confirmed = new Set(
    held.map((draft) => draft.expenseId).filter((expenseId) => input.isConfirmed(expenseId)),
  );
  for (const draft of held) {
    const outcome = heldOutcome(draft, confirmed, input.queue);
    if (outcome === 'remove') {
      input.missing.delete(draft.captureId);
      await input.drafts.remove(input.ownerId, draft.captureId);
    } else if (outcome === 'wait') {
      input.missing.delete(draft.captureId);
    } else if (!input.missing.has(draft.captureId)) {
      input.missing.set(draft.captureId, input.syncMark);
    } else if (input.missing.get(draft.captureId) !== input.syncMark) {
      input.missing.delete(draft.captureId);
      await input.drafts.reopen(input.ownerId, draft.captureId);
    }
  }
}
