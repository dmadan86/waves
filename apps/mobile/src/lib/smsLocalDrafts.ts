/**
 * SMS drafts stay on the phone until they are used.
 *
 * A draft made from a bank message — read out of the inbox or pasted — used to
 * be a capture, and a capture syncs: every device on the account pulled the
 * amount, the shop, the day, the bank's sender id and the card's last digits
 * into its own Review tab. Somebody who installed the app on an iPad found
 * their phone's bank messages waiting there. Nothing about a bank message is
 * the iPad's business until the person does something with it.
 *
 * So the rule is: **nothing derived from an SMS reaches the server as a
 * capture.** The draft lives in `smsDraftStore` on this device, sealed at rest,
 * and shows in this device's Review next to the synced captures. When the
 * person turns it into an expense — a group, the personal ledger — *that*
 * record syncs, exactly as if they had typed it. Dismissing it deletes it here.
 *
 * This module is the pure half of that: what counts as SMS-derived, how a
 * draft is shaped as the `CaptureRow` Review already renders, how the local and
 * synced lists merge, which synced captures the one-time move takes, and what
 * to do with a draft that has been placed in a group but whose expense has not
 * been confirmed yet. No SQLite, no React, no keystore — so every decision is
 * a unit test.
 */

import type { MirrorCapture, QueuedMutation } from '@waves/core';

import type { CaptureRow } from '@/data/types';

/** True when a capture's `parsed` blob says a bank message made it. */
export function isSmsDerived(parsed: unknown): boolean {
  return (
    !!parsed && typeof parsed === 'object' && (parsed as { source?: unknown }).source === 'sms'
  );
}

/** The fields `serialiseCapture` writes — the capture-create payload. */
export interface SerialisedCapture {
  readonly captureId: string;
  readonly description: string;
  readonly category: string | null;
  readonly expenseDate: string;
  readonly currency: string;
  readonly amount: string;
  readonly notes?: string | null;
  readonly photoPath?: string | null;
  readonly rawText?: string | null;
  readonly parsed?: Record<string, unknown> | null;
  readonly paymentMethod?: string | null;
  readonly targetGroupId?: string | null;
  readonly categoryMeta?: CaptureRow['category_meta'];
  readonly location?: CaptureRow['location'];
}

/**
 * A capture payload as the row Review renders, marked `local`.
 *
 * `existing` is the draft being edited, so an edit keeps what it does not
 * name (its creation time, and any field the payload leaves out) the way the
 * queue overlay does for a synced capture.
 */
export function draftRowFromPayload(
  ownerId: string,
  payload: SerialisedCapture,
  createdAt: string,
  existing?: CaptureRow,
): CaptureRow {
  const keep = <K extends keyof SerialisedCapture, V>(key: K, fallback: V): V =>
    key in payload ? ((payload[key] as V | undefined) ?? (null as V)) : fallback;
  return {
    id: payload.captureId,
    owner_user_id: ownerId,
    description: payload.description,
    category: payload.category ?? null,
    category_meta: keep('categoryMeta', existing?.category_meta ?? null),
    expense_date: payload.expenseDate,
    currency: payload.currency,
    amount: payload.amount,
    notes: keep('notes', existing?.notes ?? null),
    photo_path: keep('photoPath', existing?.photo_path ?? null),
    raw_text: keep('rawText', existing?.raw_text ?? null),
    parsed: keep('parsed', existing?.parsed ?? null),
    payment_method: keep('paymentMethod', existing?.payment_method ?? null),
    target_group_id: keep('targetGroupId', existing?.target_group_id ?? null),
    location: keep('location', existing?.location ?? null),
    status: 'open' as CaptureRow['status'],
    assigned_expense_id: null,
    assigned_group_id: null,
    created_at: existing?.created_at ?? createdAt,
    local: true,
  };
}

/** A synced capture copied into the local store by the one-time move. */
export function draftRowFromCapture(capture: MirrorCapture): CaptureRow {
  return {
    id: capture.id,
    owner_user_id: capture.owner_user_id,
    description: capture.description,
    category: capture.category,
    category_meta: capture.category_meta,
    expense_date: capture.expense_date,
    currency: capture.currency,
    // A server row's amount is a JSON number at runtime, whatever the type
    // says; the local store keeps the string every reader expects.
    amount: String(capture.amount),
    notes: capture.notes,
    photo_path: capture.photo_path,
    // Whatever the server row had, and nothing invented: an inbox-read draft
    // was written with no body, so this is null for those.
    raw_text: capture.raw_text,
    parsed: capture.parsed,
    payment_method: capture.payment_method,
    target_group_id: capture.target_group_id,
    location: capture.location,
    status: 'open' as CaptureRow['status'],
    assigned_expense_id: null,
    assigned_group_id: null,
    created_at: capture.created_at,
    local: true,
  };
}

const newestFirst = (a: CaptureRow, b: CaptureRow): number =>
  a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;

/**
 * Review's list: the synced captures and this device's SMS drafts, as one.
 *
 * The same id in both is the one-time move mid-flight — the draft copied here,
 * the server copy's delete not yet synced. The local one wins, so the row is
 * shown once and every action on it goes to the local store.
 */
export function mergeCaptureLists(
  synced: readonly CaptureRow[],
  local: readonly CaptureRow[],
): CaptureRow[] {
  if (local.length === 0) return synced as CaptureRow[];
  const localIds = new Set(local.map((row) => row.id));
  return [...local, ...synced.filter((row) => !localIds.has(row.id))].sort(newestFirst);
}

/** The dedupe key a capture's `parsed` blob carries, if any. */
export function dedupeKeyOf(parsed: unknown): string | null {
  const key = (parsed as { dedupeKey?: unknown } | null)?.dedupeKey;
  return typeof key === 'string' ? key : null;
}

/**
 * Was this SMS capture made from a message *this device* read?
 *
 * The one-time move runs on every Android device on the account, and a
 * synced SMS capture may have been made on another phone. Copying that into
 * this device's store would re-create the very leak this change closes — a
 * second phone holding the first phone's bank messages — and duplicate the
 * draft. The only proof a capture belongs here is its dedupe key in this
 * device's own message store (`smsMessageStore.knownKeys`): the inbox reader
 * saves every message it reads there. A pasted draft carries no such proof
 * (the paste screen keeps nothing on the device), so it is not moved; the
 * server cleanup script handles it instead. When in doubt, do not move.
 */
export function readOnThisDevice(capture: MirrorCapture, localKeys: ReadonlySet<string>): boolean {
  const key = dedupeKeyOf(capture.parsed);
  return key !== null && localKeys.has(key);
}

/**
 * The synced captures the one-time move takes: open, not deleted, made from a
 * bank message this device read. A capture already turned into an expense is
 * `assigned` and is left exactly where it is.
 */
export function capturesToMove(
  captures: readonly MirrorCapture[],
  localKeys: ReadonlySet<string>,
): MirrorCapture[] {
  return captures.filter(
    (capture) =>
      capture.status === 'open' &&
      capture.deleted_at === null &&
      isSmsDerived(capture.parsed) &&
      readOnThisDevice(capture, localKeys),
  );
}

/**
 * Synced SMS captures from this device that are already answered — dismissed
 * (deleted) or turned into an expense (assigned). The move writes a local
 * tombstone for each, because the server cleanup scrubs their `parsed` blob,
 * and after that nothing else would stop the reader re-proposing the message.
 */
export function capturesToTombstone(
  captures: readonly MirrorCapture[],
  localKeys: ReadonlySet<string>,
): MirrorCapture[] {
  return captures.filter(
    (capture) =>
      (capture.deleted_at !== null || capture.status === 'assigned') &&
      isSmsDerived(capture.parsed) &&
      readOnThisDevice(capture, localKeys),
  );
}

/** A draft placed in a group, waiting on its expense. */
export interface HeldDraft {
  readonly captureId: string;
  readonly groupId: string;
  readonly expenseId: string;
}

export type HeldOutcome = 'file' | 'missing' | 'wait';

/**
 * What to do with a draft placed in a group, now.
 *
 * A synced capture is only closed once the server has its expense (the queue
 * holds the `capture.assign` behind it, and the server refuses to close
 * against an expense that is not there). A local draft gets the same
 * guarantee here, because "a refusal is not a deletion": if the expense is
 * refused and the person discards it, the draft must come back rather than
 * having been thrown away the moment the expense was queued.
 *
 *   * the expense is in the mirror — the server has it — so the draft is filed;
 *   * the expense is still on the queue — wait;
 *   * neither — `missing`. Usually that means it was discarded and the draft
 *     should come back to Review; but an acknowledged expense whose row has
 *     not been pulled yet looks the same, and reopening it then would invite a
 *     second copy of the same spend. So the caller only reopens a draft that
 *     is still missing after two further completed syncs
 *     (`smsDraftUpkeep.reconcileHeld`).
 */
export function heldOutcome(
  held: HeldDraft,
  confirmedExpenseIds: ReadonlySet<string>,
  queue: readonly QueuedMutation[],
): HeldOutcome {
  if (confirmedExpenseIds.has(held.expenseId)) return 'file';
  const queued = queue.some(
    (mutation) =>
      (mutation.payload as { expenseId?: unknown } | null)?.expenseId === held.expenseId,
  );
  return queued ? 'wait' : 'missing';
}

// ─────────────────────────────────────────────────────────── sign-out ──

/** The key prefix a local SMS draft carries in the sign-out device copy. */
export const SMS_DRAFT_COPY_PREFIX = 'sms-draft:';

/**
 * Local SMS drafts as entries in the sign-out copy (`saveDeviceCopy`).
 *
 * They never synced, so after sign-out this file is the only copy — the same
 * standing as a half-typed expense form, and carried the same way.
 */
export function smsDraftsAsDeviceDrafts(
  rows: readonly CaptureRow[],
): { key: string; value: unknown; savedAt: string }[] {
  return rows.map((row) => ({
    key: `${SMS_DRAFT_COPY_PREFIX}${row.id}`,
    value: row,
    savedAt: row.created_at,
  }));
}

/**
 * How many things sign-out would lose that the account has never seen.
 *
 * Local SMS drafts count: sign-out wipes them (`sync/localWipe.ts`) and there
 * is no server copy to come back on the next sign-in.
 */
export function signOutAtRiskCount(input: {
  readonly unsentMutations: number;
  readonly unsentReceipts: number;
  readonly formDrafts: number;
  readonly smsDrafts: number;
}): number {
  return input.unsentMutations + input.unsentReceipts + input.formDrafts + input.smsDrafts;
}
