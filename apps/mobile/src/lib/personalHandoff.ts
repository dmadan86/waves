/**
 * Moving a personal entry into a group (a split with someone, a trip it belongs
 * to) is two writes: the group expense is created, the personal entry goes.
 * The order is the whole point (decision D7):
 *
 *   • the group save comes FIRST and the entry is deleted only after it
 *     succeeded, so a failed save never loses the entry;
 *   • undo is the mirror image: the entry is put back FIRST, with the same id
 *     and the same data (carried fields included), and only then is the group
 *     expense deleted, so an undo that fails half way leaves the money in at
 *     least one place.
 *
 * Pure of React and of storage: callers pass the writes in.
 */

/** What was moved, enough to put the entry back exactly as it was. */
export interface MoveSnapshot {
  /** The personal record's id; restoring reuses it. */
  readonly personalId: string;
  /** The record's data as stored, so unknown fields survive the round trip. */
  readonly data: Readonly<Record<string, unknown>>;
  /** The group expense that replaced it. */
  readonly groupId: string;
  readonly expenseId: string;
}

export interface MoveResult {
  /** The group expense was saved. */
  readonly saved: true;
  /** The personal entry was deleted. False when that delete failed: the entry
   *  stays, a duplicate the person can remove, never a lost expense. */
  readonly removed: boolean;
}

/**
 * Run the group save, then delete the personal entry. If `save` throws the
 * error propagates and `removePersonal` is never called.
 */
export async function moveAfterSave(
  save: () => Promise<unknown>,
  removePersonal: () => Promise<unknown>,
): Promise<MoveResult> {
  await save();
  try {
    await removePersonal();
    return { saved: true, removed: true };
  } catch {
    return { saved: true, removed: false };
  }
}

/**
 * Undo a move: re-upsert the personal entry with its own id and data, then
 * delete the group expense. If the restore throws, the group expense is left
 * alone and the error propagates.
 */
export async function undoMove(
  snapshot: MoveSnapshot,
  deps: {
    restorePersonal: (recordId: string, data: Record<string, unknown>) => Promise<unknown>;
    deleteExpense: (groupId: string, expenseId: string) => Promise<unknown>;
  },
): Promise<void> {
  await deps.restorePersonal(snapshot.personalId, { ...snapshot.data });
  await deps.deleteExpense(snapshot.groupId, snapshot.expenseId);
}

// The most recent move this session, for an Undo that outlives the form that
// made it. Memory only: an app restart forgets it, as the 6 s ring would.
let lastMove: MoveSnapshot | null = null;

export function rememberMove(snapshot: MoveSnapshot): void {
  lastMove = snapshot;
}

export function lastRememberedMove(): MoveSnapshot | null {
  return lastMove;
}

export function forgetMove(): void {
  lastMove = null;
}
