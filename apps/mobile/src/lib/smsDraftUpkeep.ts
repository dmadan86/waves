/**
 * The two jobs that keep local SMS drafts honest after they are written.
 *
 * 1. **The one-time move.** Before drafts stayed on the phone, every SMS
 *    draft was a synced capture, and those are still on the server — which is
 *    exactly how an iPad came to show a phone's bank messages. On an Android
 *    phone, once, after its first sync this session:
 *
 *      * each open, unassigned SMS capture **made from a message this phone
 *        read** (its dedupe key is in this phone's message store) is copied
 *        into the local store as it was — no body is invented; an inbox draft
 *        never had one — and then removed from the server with the ordinary
 *        `capture.delete`, so every other device drops it on its next pull;
 *      * each SMS capture from this phone that is already answered (deleted,
 *        or assigned to an expense) gets a local tombstone, so the reader does
 *        not re-propose the message once the server cleanup has scrubbed it.
 *
 *    A capture another device made is never touched: copying it here would
 *    put that phone's bank messages on this one. Pasted drafts carry no proof
 *    of where they were made, so they are not moved either; the server
 *    cleanup script (`packages/db/scripts/sms-captures-cleanup.sql`) handles
 *    both.
 *
 *    It is safe to interrupt: the copy is keyed by the capture's own id and
 *    will not write twice, and the delete is only queued after the copy is on
 *    disk — so a kill between the two leaves the draft in both places, and the
 *    next run finishes the job. It is marked done only when every capture it
 *    found went through.
 *
 * 2. **Held drafts.** A draft placed in a group is hidden from Review but not
 *    filed until its expense is on the server (`smsLocalDrafts.heldOutcome`).
 *    If the expense is refused and discarded, the draft comes back.
 *
 * Both are plain functions with everything they touch handed in, so they are
 * tested without a device; `useSmsDraftUpkeep.ts` is the React wiring.
 */

import type { MirrorCapture, QueuedMutation } from '@waves/core';

import type { DraftCache } from './smsDraftCache';
import {
  capturesToMove,
  capturesToTombstone,
  draftRowFromCapture,
  heldOutcome,
} from './smsLocalDrafts';

export interface MoveInput {
  readonly ownerId: string;
  /** This owner's captures, server rows with the queue replayed on top. */
  readonly captures: readonly MirrorCapture[];
  /** Dedupe keys of the messages this device read (`smsMessageStore.knownKeys`). */
  readonly localKeys: ReadonlySet<string>;
  readonly drafts: DraftCache;
  /** Queue the server copy's removal — `capture.delete`, straight to the queue. */
  readonly deleteServerCapture: (captureId: string) => Promise<void>;
  readonly isDone: (ownerId: string) => Promise<boolean>;
  readonly markDone: (ownerId: string) => Promise<void>;
}

export interface MoveResult {
  /** Captures copied and queued for removal this run. */
  readonly moved: number;
  /** Local tombstones written for captures this device had already answered. */
  readonly tombstoned: number;
  /** Whether the move is now recorded as finished for this account. */
  readonly done: boolean;
}

/** Take this device's synced SMS drafts off the server and onto this phone. */
export async function moveSyncedSmsDrafts(input: MoveInput): Promise<MoveResult> {
  if (!input.ownerId) return { moved: 0, tombstoned: 0, done: false };
  if (await input.isDone(input.ownerId)) return { moved: 0, tombstoned: 0, done: true };

  const mine = input.captures.filter((capture) => capture.owner_user_id === input.ownerId);
  let moved = 0;
  let tombstoned = 0;
  let failed = false;

  for (const capture of capturesToMove(mine, input.localKeys)) {
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

  for (const capture of capturesToTombstone(mine, input.localKeys)) {
    try {
      if (await input.drafts.markHandled(input.ownerId, capture.id)) tombstoned += 1;
    } catch {
      failed = true;
    }
  }

  if (failed) return { moved, tombstoned, done: false };
  await input.markDone(input.ownerId);
  return { moved, tombstoned, done: true };
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
   * Drafts seen with their expense missing, and every distinct sync mark seen
   * since. Kept by the caller across runs.
   */
  readonly missing: Map<string, (string | null)[]>;
}

/**
 * Completed syncs a held draft must stay missing through, after the one it
 * was first found missing in, before it is reopened. Two, so a sync that ran
 * before the expense's group was pulled cannot bring a draft back beside the
 * expense it already became.
 */
export const REOPEN_AFTER_SYNCS = 2;

/** File drafts whose expense landed; reopen ones whose expense was discarded. */
export async function reconcileHeld(input: ReconcileInput): Promise<void> {
  if (!input.ownerId) return;
  const held = await input.drafts.heldDrafts(input.ownerId);
  const confirmed = new Set(
    held.map((draft) => draft.expenseId).filter((expenseId) => input.isConfirmed(expenseId)),
  );
  for (const draft of held) {
    const outcome = heldOutcome(draft, confirmed, input.queue);
    if (outcome === 'file') {
      input.missing.delete(draft.captureId);
      await input.drafts.file(input.ownerId, draft.captureId);
      continue;
    }
    if (outcome === 'wait') {
      input.missing.delete(draft.captureId);
      continue;
    }
    const marks = input.missing.get(draft.captureId) ?? [];
    if (!marks.includes(input.syncMark)) marks.push(input.syncMark);
    input.missing.set(draft.captureId, marks);
    if (marks.length > REOPEN_AFTER_SYNCS) {
      input.missing.delete(draft.captureId);
      await input.drafts.reopen(input.ownerId, draft.captureId);
    }
  }
}
