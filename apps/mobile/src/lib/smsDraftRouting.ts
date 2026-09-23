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

/** A new capture: SMS-derived ones stay here, everything else is queued. */
export async function routeCaptureCreate(
  deps: RouteDeps,
  payload: Record<string, unknown>,
): Promise<'local' | 'queued'> {
  if (isSmsDerived(payload.parsed)) {
    await deps.drafts.put(
      deps.ownerId,
      draftRowFromPayload(
        deps.ownerId,
        payload as unknown as SerialisedCapture,
        (deps.now ?? (() => new Date().toISOString()))(),
      ),
    );
    return 'local';
  }
  await deps.mutate(MutationKind.CaptureCreate, deps.ownerId, payload);
  return 'queued';
}

/** An edit: a local draft is edited in place, a synced capture is queued. */
export async function routeCaptureUpdate(
  deps: RouteDeps,
  captureId: string,
  payload: Record<string, unknown>,
): Promise<'local' | 'queued'> {
  if (await deps.drafts.isLocalDraft(deps.ownerId, captureId)) {
    await deps.drafts.update(deps.ownerId, captureId, (row) =>
      draftRowFromPayload(
        deps.ownerId,
        payload as unknown as SerialisedCapture,
        row.created_at,
        row,
      ),
    );
    return 'local';
  }
  await deps.mutate(MutationKind.CaptureUpdate, deps.ownerId, payload);
  return 'queued';
}

/** A dismissal: a local draft is deleted here and nowhere else. */
export async function routeCaptureDelete(
  deps: RouteDeps,
  captureId: string,
): Promise<'local' | 'queued'> {
  if (await deps.drafts.isLocalDraft(deps.ownerId, captureId)) {
    await deps.drafts.remove(deps.ownerId, captureId);
    return 'local';
  }
  await deps.mutate(MutationKind.CaptureDelete, deps.ownerId, { captureId });
  return 'queued';
}

/** Closing a draft against the expense it became. */
export async function routeCaptureAssign(
  deps: RouteDeps,
  input: { captureId: string; groupId: string; expenseId: string },
): Promise<'local' | 'queued'> {
  if (await deps.drafts.isLocalDraft(deps.ownerId, input.captureId)) {
    await deps.drafts.hold(deps.ownerId, input.captureId, input.groupId, input.expenseId);
    return 'local';
  }
  await deps.mutate(MutationKind.CaptureAssign, deps.ownerId, {
    captureId: input.captureId,
    groupId: input.groupId,
    expenseId: input.expenseId,
  });
  return 'queued';
}
