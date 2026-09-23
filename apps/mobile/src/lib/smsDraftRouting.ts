/**
 * Where each capture write goes: the sync queue, or this device's SMS drafts.
 *
 * The four capture hooks in `data/hooks.ts` (create, update, delete, assign)
 * are the only way a screen writes a capture, so the rule "nothing derived
 * from an SMS reaches the server as a capture" (`smsLocalDrafts.ts`) is kept
 * here, once, for every screen:
 *
 *   * a **create** whose `parsed.source` is `'sms'` goes to the device store
 *     and never onto the queue;
 *   * an **update** or **delete** of a local draft is answered locally — a
 *     delete leaves a tombstone so the message is not drafted again;
 *   * an **assign** of a local draft (it became an expense in a group) holds
 *     the draft off Review until the expense is confirmed, then it is removed
 *     (`smsDraftUpkeep.reconcileHeld`). The expense itself was queued by the
 *     caller, like any expense.
 *
 * Plain functions with the queue and the store handed in, so the routing is a
 * unit test rather than something only a device can show.
 */

import { MutationKind } from '@waves/core';

import type { DraftCache } from './smsDraftCache';
import { draftRowFromPayload, isSmsDerived, type SerialisedCapture } from './smsLocalDrafts';

/** `useSync().mutate`, as these need it. */
export type Mutate = (
  kind: MutationKind,
  scopeId: string,
  payload: Record<string, unknown>,
) => Promise<unknown>;

export interface RouteDeps {
  readonly ownerId: string;
  readonly drafts: DraftCache;
  readonly mutate: Mutate;
  readonly now?: () => string;
}

/**
 * A new capture: SMS-derived ones stay here, everything else is queued.
 * `duplicate` means this device already has that draft, or already used or
 * dismissed it — nothing was written, and a caller counting drafts must not
 * count it.
 */
export async function routeCaptureCreate(
  deps: RouteDeps,
  payload: Record<string, unknown>,
): Promise<'local' | 'duplicate' | 'queued'> {
  if (isSmsDerived(payload.parsed)) {
    const added = await deps.drafts.put(
      deps.ownerId,
      draftRowFromPayload(
        deps.ownerId,
        payload as unknown as SerialisedCapture,
        (deps.now ?? (() => new Date().toISOString()))(),
      ),
    );
    return added ? 'local' : 'duplicate';
  }
  await deps.mutate(MutationKind.CaptureCreate, deps.ownerId, payload);
  return 'queued';
}

/** Thrown when an edit reaches a local draft that can no longer be edited. */
export class SmsDraftNotEditableError extends Error {
  constructor(readonly state: 'held' | 'filed' | 'dismissed') {
    super(
      state === 'held'
        ? 'This draft is already being added to a group, so it cannot be edited.'
        : 'This draft has already been used or removed.',
    );
    this.name = 'SmsDraftNotEditableError';
  }
}

/**
 * An edit: an open local draft is edited in place, a synced capture is
 * queued. A draft already placed in a group (or used, or dismissed) refuses
 * the edit out loud rather than dropping it — and it is never sent to the
 * server as a `capture.update` for a row the server does not have.
 */
export async function routeCaptureUpdate(
  deps: RouteDeps,
  captureId: string,
  payload: Record<string, unknown>,
): Promise<'local' | 'queued'> {
  const state = await deps.drafts.stateOf(deps.ownerId, captureId);
  if (state === 'open') {
    const updated = await deps.drafts.update(deps.ownerId, captureId, (row) =>
      draftRowFromPayload(
        deps.ownerId,
        payload as unknown as SerialisedCapture,
        row.created_at,
        row,
      ),
    );
    if (!updated) throw new SmsDraftNotEditableError('held');
    return 'local';
  }
  if (state !== null) throw new SmsDraftNotEditableError(state);
  await deps.mutate(MutationKind.CaptureUpdate, deps.ownerId, payload);
  return 'queued';
}

/** A dismissal: a local draft is deleted here and nowhere else. */
export async function routeCaptureDelete(
  deps: RouteDeps,
  captureId: string,
): Promise<'local' | 'queued'> {
  const state = await deps.drafts.stateOf(deps.ownerId, captureId);
  if (state === 'open' || state === 'held') {
    await deps.drafts.remove(deps.ownerId, captureId);
    return 'local';
  }
  // Already filed or dismissed here: nothing on the server to tell.
  if (state !== null) return 'local';
  await deps.mutate(MutationKind.CaptureDelete, deps.ownerId, { captureId });
  return 'queued';
}

/** Closing a draft against the expense it became. */
export async function routeCaptureAssign(
  deps: RouteDeps,
  input: { captureId: string; groupId: string; expenseId: string },
): Promise<'local' | 'queued'> {
  const state = await deps.drafts.stateOf(deps.ownerId, input.captureId);
  if (state === 'open' || state === 'held') {
    await deps.drafts.hold(deps.ownerId, input.captureId, input.groupId, input.expenseId);
    return 'local';
  }
  if (state !== null) return 'local';
  await deps.mutate(MutationKind.CaptureAssign, deps.ownerId, {
    captureId: input.captureId,
    groupId: input.groupId,
    expenseId: input.expenseId,
  });
  return 'queued';
}
