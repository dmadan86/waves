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
  const resolved = resolveRejectedMutation(queue, envelope);
  if (resolved) return resolved;

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
 * A refused pending row is still the only copy the device has. If the person
 * edits it, repair the queued mutation instead of putting an update behind a
 * blocker. If they delete/clear it, remove the rejected pending row altogether:
 * there is nothing on the server to delete, and keeping it would keep the UI
 * stuck on something the person just removed.
 */
function resolveRejectedMutation(
  queue: readonly QueuedMutation[],
  envelope: MutationEnvelope,
): QueuedMutation[] | null {
  const incoming = targetOf(envelope);
  if (!incoming) return null;

  const index = queue.findIndex((item) => {
    if (!item.rejection) return false;
    const existing = targetOf(item);
    return (
      existing !== null &&
      existing.primaryKind === item.kind &&
      existing.groupId === incoming.groupId &&
      existing.id === incoming.id &&
      (existing.correctionKinds.includes(envelope.kind) ||
        existing.removalKinds.includes(envelope.kind))
    );
  });
  if (index < 0) return null;

  const pending = queue[index]!;
  const target = targetOf(pending)!;
  if (target.removalKinds.includes(envelope.kind)) {
    return queue.filter((_item, itemIndex) => itemIndex !== index);
  }

  // Translate the correction into the shape the blocked mutation speaks, and
  // find out what will not fit. `leftover` is the part of the edit the create
  // cannot carry — it is a real change somebody made, so it is queued behind
  // the now-unblocked create rather than quietly dropped.
  const { translated, leftover } = target.correctionKeyMap
    ? splitCorrection(envelope.payload, target.correctionKeyMap)
    : { translated: envelope.payload, leftover: null };

  const corrected: QueuedMutation = {
    ...pending,
    payload: target.mergeCorrection ? mergePayload(pending.payload, translated) : translated,
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    rejection: null,
  };
  const repaired = queue.map((item, itemIndex) => (itemIndex === index ? corrected : item));
  if (leftover === null) return repaired;
  return enqueue(repaired, { ...envelope, payload: leftover });
}

/**
 * Split a correction into the keys the blocked mutation can carry, renamed to
 * its shape, and the keys it cannot.
 *
 * `leftover` is null when everything fitted — the common case, and the one that
 * queues nothing extra.
 */
function splitCorrection(
  payload: unknown,
  keyMap: Readonly<Record<string, string>>,
): { translated: unknown; leftover: Record<string, unknown> | null } {
  if (!isRecord(payload)) return { translated: payload, leftover: null };
  const translated: Record<string, unknown> = {};
  const leftover: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    const mapped = keyMap[key];
    if (mapped === undefined) leftover[key] = value;
    else translated[mapped] = value;
  }
  return {
    translated,
    leftover: Object.keys(leftover).length > 0 ? leftover : null,
  };
}

/**
 * A `group.update` speaks in column names; a queued `group.create` payload does
 * not. Merging one into the other therefore lines up on `name` and `type` and
 * on nothing else — so correcting a refused group's icon, currency, country or
 * "simplify" wrote a key the create handler never reads, and the edit silently
 * reverted. These are the pairs, and anything not here (trip dates,
 * `archived_at`) has no create-side equivalent at all and has to stay behind as
 * a follow-up rather than be swallowed.
 */
const GROUP_UPDATE_TO_CREATE: Readonly<Record<string, string>> = {
  name: 'name',
  type: 'type',
  cover_emoji: 'emoji',
  default_currency: 'currency',
  simplify_debts: 'simplify',
  country_code: 'country',
  photo_path: 'photoPath',
};

/**
 * The same for a plan item: a create carries the day and the title, an update
 * carries `done`, and only the first two exist on the create.
 */
const PLAN_ITEM_UPDATE_TO_CREATE: Readonly<Record<string, string>> = {
  itemId: 'itemId',
  day: 'day',
  title: 'title',
};

interface MutationTarget {
  readonly primaryKind: MutationKind;
  readonly correctionKinds: readonly MutationKind[];
  readonly removalKinds: readonly MutationKind[];
  readonly groupId: string;
  readonly id: string;
  readonly mergeCorrection: boolean;
  /**
   * How a correction's keys are named in the create's payload, when the two
   * disagree. Absent means they already speak the same shape and the whole
   * payload merges. Present means a key missing from the map cannot be carried
   * by the create and is queued behind it instead of being dropped.
   */
  readonly correctionKeyMap?: Readonly<Record<string, string>>;
}

function targetOf(mutation: MutationEnvelope): MutationTarget | null {
  if (mutation.kind === MutationKind.GroupCreate || mutation.kind === MutationKind.GroupUpdate) {
    return {
      primaryKind: MutationKind.GroupCreate,
      correctionKinds: [MutationKind.GroupUpdate],
      removalKinds: [],
      groupId: mutation.groupId,
      id: mutation.groupId,
      mergeCorrection: true,
      correctionKeyMap: GROUP_UPDATE_TO_CREATE,
    };
  }

  const expenseId = stringPayloadField(mutation.payload, 'expenseId');
  if (
    expenseId &&
    (mutation.kind === MutationKind.ExpenseCreate ||
      mutation.kind === MutationKind.ExpenseUpdate ||
      mutation.kind === MutationKind.ExpenseDelete)
  ) {
    return {
      primaryKind: MutationKind.ExpenseCreate,
      correctionKinds: [MutationKind.ExpenseUpdate],
      removalKinds: [MutationKind.ExpenseDelete],
      groupId: mutation.groupId,
      id: expenseId,
      mergeCorrection: true,
    };
  }

  const captureId = stringPayloadField(mutation.payload, 'captureId');
  if (
    captureId &&
    (mutation.kind === MutationKind.CaptureCreate ||
      mutation.kind === MutationKind.CaptureUpdate ||
      mutation.kind === MutationKind.CaptureDelete)
  ) {
    return {
      primaryKind: MutationKind.CaptureCreate,
      correctionKinds: [MutationKind.CaptureUpdate],
      removalKinds: [MutationKind.CaptureDelete],
      groupId: mutation.groupId,
      id: captureId,
      mergeCorrection: true,
    };
  }

  const tagId = stringPayloadField(mutation.payload, 'tagId');
  if (
    tagId &&
    (mutation.kind === MutationKind.TagCreate ||
      mutation.kind === MutationKind.TagUpdate ||
      mutation.kind === MutationKind.TagDelete)
  ) {
    return {
      primaryKind: MutationKind.TagCreate,
      correctionKinds: [MutationKind.TagUpdate],
      removalKinds: [MutationKind.TagDelete],
      groupId: mutation.groupId,
      id: tagId,
      mergeCorrection: true,
    };
  }

  const itemId = stringPayloadField(mutation.payload, 'itemId');
  if (
    itemId &&
    (mutation.kind === MutationKind.PlanItemCreate ||
      mutation.kind === MutationKind.PlanItemUpdate ||
      mutation.kind === MutationKind.PlanItemDelete)
  ) {
    return {
      primaryKind: MutationKind.PlanItemCreate,
      correctionKinds: [MutationKind.PlanItemUpdate],
      removalKinds: [MutationKind.PlanItemDelete],
      groupId: mutation.groupId,
      id: itemId,
      mergeCorrection: true,
      correctionKeyMap: PLAN_ITEM_UPDATE_TO_CREATE,
    };
  }

  if (
    mutation.kind === MutationKind.MemberBudgetSet ||
    mutation.kind === MutationKind.MemberBudgetClear
  ) {
    return {
      primaryKind: MutationKind.MemberBudgetSet,
      correctionKinds: [MutationKind.MemberBudgetSet],
      removalKinds: [MutationKind.MemberBudgetClear],
      groupId: mutation.groupId,
      id: mutation.groupId,
      mergeCorrection: false,
    };
  }

  if (mutation.kind === MutationKind.GroupBudgetSet) {
    return {
      primaryKind: MutationKind.GroupBudgetSet,
      correctionKinds: [MutationKind.GroupBudgetSet],
      removalKinds: [],
      groupId: mutation.groupId,
      id: mutation.groupId,
      mergeCorrection: false,
    };
  }

  const category = stringPayloadField(mutation.payload, 'category');
  if (category && mutation.kind === MutationKind.CategoryBudgetSet) {
    return {
      primaryKind: MutationKind.CategoryBudgetSet,
      correctionKinds: [MutationKind.CategoryBudgetSet],
      removalKinds: [],
      groupId: mutation.groupId,
      id: category,
      mergeCorrection: false,
    };
  }

  const from = stringPayloadField(mutation.payload, 'from');
  if (from && mutation.kind === MutationKind.GroupFxRateSet) {
    return {
      primaryKind: MutationKind.GroupFxRateSet,
      correctionKinds: [MutationKind.GroupFxRateSet],
      removalKinds: [],
      groupId: mutation.groupId,
      id: from,
      mergeCorrection: false,
    };
  }

  const recordId = stringPayloadField(mutation.payload, 'recordId');
  if (
    recordId &&
    (mutation.kind === MutationKind.PersonalUpsert || mutation.kind === MutationKind.PersonalDelete)
  ) {
    return {
      primaryKind: MutationKind.PersonalUpsert,
      correctionKinds: [MutationKind.PersonalUpsert],
      removalKinds: [MutationKind.PersonalDelete],
      groupId: mutation.groupId,
      id: recordId,
      mergeCorrection: false,
    };
  }

  return null;
}

function stringPayloadField(payload: unknown, field: string): string | null {
  if (!payload || typeof payload !== 'object' || !(field in payload)) return null;
  const value = payload[field as keyof typeof payload];
  return typeof value === 'string' ? value : null;
}

function mergePayload(first: unknown, second: unknown): unknown {
  if (!isRecord(first) || !isRecord(second)) return second;
  return { ...first, ...second };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
  return stringPayloadField(mutation.payload, 'expenseId') ?? undefined;
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

/**
 * Send it again now — the user tapped "retry".
 *
 * Clears the refusal as well as the backoff. `nextBatch` skips a marked
 * mutation outright, so resetting only `attempts` would leave the mutation
 * exactly as stuck as it was: a retry that visibly does nothing.
 */
export function retryNow(
  queue: readonly QueuedMutation[],
  clientMutationId: string,
): QueuedMutation[] {
  return queue.map((item) =>
    item.clientMutationId === clientMutationId
      ? { ...item, attempts: 0, nextAttemptAt: 0, lastError: null, rejection: null }
      : item,
  );
}
