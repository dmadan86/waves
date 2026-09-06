/**
 * The offline mutation queue (ADR-005 / TDR §4).
 *
 * Pure data in, pure data out: the queue is the hardest part of the client, so
 * it lives here where it can be property-tested in Node rather than on a device
 * (ADR-014). The mobile app owns persistence (SQLite); this module owns the
 * rules about what gets sent, in what order, and what happens when it fails.
 *
 * Two rules drive everything:
 *
 *  1. **Order is preserved within a group.** An edit that follows a create must
 *     never overtake it, so a stalled mutation blocks everything behind it in
 *     the same group — and nothing at all in any other group.
 *  2. **Nothing is ever silently dropped.** A mutation leaves the queue only
 *     when the server confirms it applied or confirms it is a duplicate.
 *  3. **A refusal is not a deletion.** A rejected mutation *stays* in the
 *     queue, marked with its reason, until a person retries or discards it.
 *
 * Rule 3 is not bookkeeping — it is what keeps the thing the mutation made on
 * screen. Every local read is the mirror with the queue laid over it, so a
 * group created offline is visible because its `group.create` is in the queue.
 * Dropping a rejection therefore *deleted* the group: the phone showed "Group
 * not found" for a group somebody had just made, and the only trace was a red
 * glyph in a corner. What the person made is theirs; a server that will not
 * take it does not get to take it away.
 */

import { MutationKind } from './protocol';
import type { MutationEnvelope, SyncMutationOutcome, SyncRejectionCode } from './protocol';

export interface QueuedMutation extends MutationEnvelope {
  /** Local insertion order. The queue is FIFO and this is the tiebreak. */
  readonly seq: number;
  readonly attempts: number;
  /** Unix ms before which this mutation must not be retried. */
  readonly nextAttemptAt: number;
  readonly lastError?: string | null;
  /**
   * Set when the server refused this mutation. It stays in the queue carrying
   * this, rather than leaving — see rule 3 above. Never retried on its own; a
   * person clears it by retrying or discarding.
   */
  readonly rejection?: { readonly code: SyncRejectionCode; readonly message: string } | null;
}

/** Mutations that failed this many times stop retrying and ask the user. */
export const MAX_ATTEMPTS = 8;

/** Roughly 2s, 4s, 8s … capped at five minutes. Deterministic: no jitter, so tests can assert it. */
export function backoffMs(attempts: number): number {
  const exponential = 2000 * 2 ** Math.max(0, attempts - 1);
  return Math.min(exponential, 5 * 60_000);
}

export function enqueue(
  queue: readonly QueuedMutation[],
  envelope: MutationEnvelope,
): QueuedMutation[] {
  // Re-making a mutation that is already here replaces it, in its own place in
  // the order. This matters now that a refusal stays in the queue: appending
  // would leave two entries under one `clientMutationId` — two rows in the
  // overlay and two banners for one change — and the server, which dedupes on
  // that id, would only ever hear about one of them.
  const existing = queue.find((item) => item.clientMutationId === envelope.clientMutationId);
  const seq = existing
    ? existing.seq
    : queue.reduce((highest, item) => Math.max(highest, item.seq), 0) + 1;
  const queued: QueuedMutation = {
    ...envelope,
    seq,
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    rejection: null,
  };
  if (existing) {
    return queue.map((item) =>
      item.clientMutationId === envelope.clientMutationId ? queued : item,
    );
  }
  return coalesce([...queue, queued]);
}

/**
 * Collapse consecutive un-sent edits of the same expense.
 *
 * Someone editing offline produces one mutation per save. Every one of those
 * would become a version nobody ever saw (ADR-004 keeps versions forever), so
 * the intermediate ones are noise. Only *adjacent* and *never-attempted*
 * updates of the same expense collapse — anything already in flight has been
 * seen by the server and must keep its own identity for idempotency.
 */
function coalesce(queue: readonly QueuedMutation[]): QueuedMutation[] {
  const result: QueuedMutation[] = [];
  for (const item of queue) {
    const previous = result[result.length - 1];
    const collapsible =
      previous !== undefined &&
      // A refused edit has been seen by the server and is waiting on a person;
      // folding a newer edit into it would silently change what they decide about.
      !previous.rejection &&
      previous.kind === MutationKind.ExpenseUpdate &&
      item.kind === MutationKind.ExpenseUpdate &&
      previous.attempts === 0 &&
      item.attempts === 0 &&
      previous.groupId === item.groupId &&
      expenseIdOf(previous) !== undefined &&
      expenseIdOf(previous) === expenseIdOf(item);

    if (collapsible) {
      // Keep the newest payload and the newest id: the older one was never sent,
      // so no server has ever heard of it.
      result[result.length - 1] = { ...item, seq: previous.seq };
    } else {
      result.push(item);
    }
  }
  return result;
}

function expenseIdOf(mutation: MutationEnvelope): string | undefined {
  const payload = mutation.payload as { expenseId?: unknown } | null;
  return typeof payload?.expenseId === 'string' ? payload.expenseId : undefined;
}

export interface BatchOptions {
  readonly now: number;
  readonly limit?: number;
  readonly maxAttempts?: number;
}

/**
 * The next mutations to send, in order.
 *
 * A group whose head mutation is waiting out a backoff contributes nothing at
 * all this round — sending its later mutations would apply an edit before the
 * create it depends on. Other groups are unaffected, so one poisoned expense
 * cannot stop the rest of the app from syncing.
 */
export function nextBatch(
  queue: readonly QueuedMutation[],
  options: BatchOptions,
): QueuedMutation[] {
  const { now, limit = 50, maxAttempts = MAX_ATTEMPTS } = options;
  const blocked = new Set<string>();
  const batch: QueuedMutation[] = [];

  for (const item of [...queue].sort((a, b) => a.seq - b.seq)) {
    if (blocked.has(item.groupId)) continue;
    // A refusal is the server's settled answer, so this is not a backoff to
    // wait out — resending would fail identically, forever. It blocks its group
    // for the same reason a stalled mutation does: what is queued behind it
    // depends on it.
    if (item.rejection) {
      blocked.add(item.groupId);
      continue;
    }
    if (item.attempts >= maxAttempts || item.nextAttemptAt > now) {
      blocked.add(item.groupId);
      continue;
    }
    batch.push(item);
    if (batch.length >= limit) break;
  }
  return batch;
}

/** The refused mutations still sitting in the queue, oldest first. */
export function rejectedMutations(queue: readonly QueuedMutation[]): QueuedMutation[] {
  return queue.filter((item) => Boolean(item.rejection)).sort((a, b) => a.seq - b.seq);
}

/**
 * What is genuinely still on its way — the queue minus what the server has
 * already refused. This is the count a "sending 1 change…" line may use: a
 * refusal is not in flight, and saying it is would be a lie that never resolves.
 */
export function pendingMutations(queue: readonly QueuedMutation[]): QueuedMutation[] {
  return queue.filter((item) => !item.rejection);
}

/** Clear a refusal so the mutation is sent again from a clean slate. */
export function clearRejection(
  queue: readonly QueuedMutation[],
  clientMutationId: string,
): QueuedMutation[] {
  return queue.map((item) =>
    item.clientMutationId === clientMutationId
      ? { ...item, rejection: null, attempts: 0, nextAttemptAt: 0, lastError: null }
      : item,
  );
}

/** Mutations that have given up retrying and need the user to decide. */
export function deadLettered(
  queue: readonly QueuedMutation[],
  maxAttempts = MAX_ATTEMPTS,
): QueuedMutation[] {
  return queue.filter((item) => item.attempts >= maxAttempts);
}

export interface OutcomeResult {
  readonly queue: QueuedMutation[];
  /** Rejected mutations, so the UI can explain what happened and to what. */
  readonly rejected: readonly {
    mutation: QueuedMutation;
    code: SyncRejectionCode;
    message: string;
  }[];
}

/**
 * Fold a server response back into the queue.
 *
 * `applied` and `duplicate` both mean the server has it, so both remove the
 * mutation — that is exactly what makes replay after a crash safe.
 */
export function applyOutcomes(
  queue: readonly QueuedMutation[],
  outcomes: readonly SyncMutationOutcome[],
): OutcomeResult {
  const byId = new Map(outcomes.map((outcome) => [outcome.clientMutationId, outcome]));
  const remaining: QueuedMutation[] = [];
  const rejected: { mutation: QueuedMutation; code: SyncRejectionCode; message: string }[] = [];

  for (const item of queue) {
    const outcome = byId.get(item.clientMutationId);
    if (outcome === undefined) {
      remaining.push(item);
      continue;
    }
    if (outcome.status === 'applied' || outcome.status === 'duplicate') continue;
    // Kept, not dropped (rule 3): the queue overlay is what puts this mutation's
    // row on screen, so removing it here would delete what the person made.
    const marked: QueuedMutation = {
      ...item,
      rejection: { code: outcome.code, message: outcome.message },
    };
    remaining.push(marked);
    rejected.push({ mutation: marked, code: outcome.code, message: outcome.message });
  }

  return { queue: remaining, rejected: [...rejected] };
}

/**
 * The whole batch failed to reach the server (offline, 500, timeout). Nothing
 * is dropped; every mutation in the batch waits out its own backoff.
 */
export function markFailed(
  queue: readonly QueuedMutation[],
  batch: readonly QueuedMutation[],
  error: string,
  now: number,
): QueuedMutation[] {
  const ids = new Set(batch.map((item) => item.clientMutationId));
  return queue.map((item) => {
    if (!ids.has(item.clientMutationId)) return item;
    const attempts = item.attempts + 1;
    return { ...item, attempts, nextAttemptAt: now + backoffMs(attempts), lastError: error };
  });
}

/** Drop a dead-lettered mutation the user has chosen to abandon. */
export function discard(
  queue: readonly QueuedMutation[],
  clientMutationId: string,
): QueuedMutation[] {
  return queue.filter((item) => item.clientMutationId !== clientMutationId);
}

/** Send it again now, ignoring the backoff — the user tapped "retry". */
export function retryNow(
  queue: readonly QueuedMutation[],
  clientMutationId: string,
): QueuedMutation[] {
  return queue.map((item) =>
    item.clientMutationId === clientMutationId
      ? { ...item, attempts: 0, nextAttemptAt: 0, lastError: null }
      : item,
  );
}
