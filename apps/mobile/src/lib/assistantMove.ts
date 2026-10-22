/**
 * Moving the saved expense to another ledger, as an operation that can be
 * resumed. A move is two writes (the new entry, then the removal of the old
 * one); when the second fails the first stays, so a retry must pick up where it
 * stopped instead of creating a second destination.
 *
 * The state lives in a ref owned by the panel ({@link MoveProgress}); the writes
 * are passed in. `completed` runs only after both writes went through, which is
 * when the panel may switch the write base it keeps for the expense.
 */

import type { MovePlan } from '@/lib/assistantCorrections';
import type { SavedState } from '@/lib/followUpApply';

/** Where a destination entry was written, enough to take it back out. */
export type MoveDestination =
  | { readonly kind: 'group'; readonly groupId: string; readonly id: string }
  | { readonly kind: 'personal'; readonly id: string };

export interface MoveProgress {
  readonly sourceId: string;
  readonly destination: MoveDestination;
  /** The destination exists (written); only the source removal is left. */
  destWritten: boolean;
}

export interface MoveIo {
  writeDestination(plan: MovePlan): Promise<unknown>;
  removeSource(from: SavedState): Promise<unknown>;
  /** Take a stranded destination of an earlier attempt back out. */
  removeDestination(destination: MoveDestination): Promise<unknown>;
  /** Both writes are done: switch to the new write base. */
  completed(plan: MovePlan): void;
}

export function destinationOf(plan: MovePlan): MoveDestination {
  return plan.kind === 'toGroup'
    ? { kind: 'group', groupId: plan.groupId, id: plan.write.expenseId }
    : { kind: 'personal', id: plan.recordId };
}

const same = (a: MoveDestination, b: MoveDestination): boolean =>
  a.kind === b.kind &&
  a.id === b.id &&
  (a.kind !== 'group' || b.kind !== 'group' || a.groupId === b.groupId);

/** Run (or resume) the move. False when a step failed; the progress is kept for the retry. */
export async function runMove(
  ref: { current: MoveProgress | null },
  plan: MovePlan,
  from: SavedState,
  io: MoveIo,
): Promise<boolean> {
  try {
    const destination = destinationOf(plan);
    const prior = ref.current && ref.current.sourceId === from.id ? ref.current : null;
    // An earlier attempt wrote somewhere else: that copy would be a duplicate.
    if (prior && prior.destWritten && !same(prior.destination, destination)) {
      await io.removeDestination(prior.destination);
      ref.current = null;
    }
    const op: MoveProgress =
      ref.current && ref.current.sourceId === from.id && same(ref.current.destination, destination)
        ? ref.current
        : { sourceId: from.id, destination, destWritten: false };
    ref.current = op;
    if (!op.destWritten) {
      await io.writeDestination(plan);
      op.destWritten = true;
    }
    await io.removeSource(from);
    ref.current = null;
    io.completed(plan);
    return true;
  } catch {
    return false;
  }
}
