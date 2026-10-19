/**
 * Undo for the assistant, on the phone. After an expense is saved the panel
 * shows a 6 second ring on "Undo", then a plain "Undo" link until it closes
 * (D2). Undo removes the expense and offers "Restore"; a correction or a
 * follow-up answer can be taken back one step at a time; a move or a hand-off
 * (a lend that became a loan, a duplicate removed) is reversed as a pair.
 *
 * The writes are passed in ({@link UndoDeps}), so this is plain logic and the
 * panel supplies the real hooks. A personal record that was deleted is a
 * tombstone the sync layer keeps, so "restore" writes it again under a fresh id
 * rather than reviving the old one; a group expense has a real restore.
 */

import type { TypedResult } from '@/lib/assistantCorrections';
import { toPersonalData, type SavedState } from '@/lib/followUpApply';
import { undoMove, type MoveSnapshot } from '@/lib/personalHandoff';

/** How long the ring runs on the first Undo (D2); after it the link stays. */
export const UNDO_RING_MS = 6000;
/** Steps of in-panel history kept for taking back answers and corrections. */
export const HISTORY_MAX = 5;

export type UndoPhase = 'ring' | 'link';

export function undoPhase(elapsedMs: number): UndoPhase {
  return elapsedMs < UNDO_RING_MS ? 'ring' : 'link';
}

/** 1 at the start of the ring, 0 at its end. */
export function ringFraction(elapsedMs: number): number {
  return Math.max(0, Math.min(1, 1 - elapsedMs / UNDO_RING_MS));
}

/* ───────────────────────────────── history ───────────────────────────────── */

export type UndoEntry =
  /** An in-place change: a follow-up answer or a correction. */
  | { readonly kind: 'edit'; readonly previous: SavedState; readonly what: 'answer' | 'correction' }
  /** A move to another ledger: `previous` still exists, deleted; `current` is the new entry. */
  | {
      readonly kind: 'move';
      readonly previous: SavedState;
      readonly current: SavedState;
      readonly carried?: Readonly<Record<string, unknown>>;
    }
  /** A personal spend turned into a loan: the txn was deleted, the loan created. */
  | {
      readonly kind: 'lend';
      readonly previous: SavedState;
      readonly loanId: string;
      readonly carried?: Readonly<Record<string, unknown>>;
    }
  /** My copy of a duplicate removed. */
  | { readonly kind: 'duplicate'; readonly previous: SavedState }
  /**
   * A personal entry moved into a group from the add-expense form (a split, a
   * trip). `previous` is that entry as the panel held it; the snapshot says
   * which group expense replaced it.
   */
  | { readonly kind: 'handoff'; readonly previous: SavedState; readonly snapshot: MoveSnapshot };

export function pushHistory(history: readonly UndoEntry[], entry: UndoEntry): UndoEntry[] {
  return [...history, entry].slice(-HISTORY_MAX);
}

export function popHistory(history: readonly UndoEntry[]): {
  entry: UndoEntry | null;
  rest: UndoEntry[];
} {
  if (history.length === 0) return { entry: null, rest: [] };
  return { entry: history[history.length - 1] ?? null, rest: history.slice(0, -1) };
}

/* ─────────────────────────────────── writes ─────────────────────────────────── */

export interface UndoDeps {
  deleteGroupExpense(groupId: string, expenseId: string): Promise<unknown>;
  restoreGroupExpense(groupId: string, expenseId: string): Promise<unknown>;
  deletePersonal(recordId: string): Promise<unknown>;
  upsertPersonal(input: {
    recordId: string;
    recordKind: 'txn';
    data: Record<string, unknown>;
  }): Promise<unknown>;
  /** Write a state in place (the same persist the follow-ups use). */
  persist(next: SavedState): Promise<boolean>;
  /** A fresh id. */
  newId(): string;
  /**
   * The group expense a loan was shared as (a synced loan), looked up when the
   * undo runs because sharing can happen after the answer. Null: not shared.
   */
  sharedLoanExpense?(loanId: string): { groupId: string; expenseId: string } | null;
}

/** Remove the just-saved expense: a group one is soft-deleted (restorable from Activity). */
export async function removeSaved(state: SavedState, deps: UndoDeps): Promise<void> {
  if (state.kind === 'group') {
    if (!state.groupId) throw new Error('group expense without a group');
    await deps.deleteGroupExpense(state.groupId, state.id);
  } else {
    await deps.deletePersonal(state.id);
  }
}

/** Bring a removed expense back. A personal one returns under a new id; the state says which. */
export async function restoreRemoved(
  state: SavedState,
  deps: UndoDeps,
  carried?: Readonly<Record<string, unknown>>,
): Promise<SavedState> {
  if (state.kind === 'group') {
    if (!state.groupId) throw new Error('group expense without a group');
    await deps.restoreGroupExpense(state.groupId, state.id);
    return state;
  }
  const id = deps.newId();
  const revived: SavedState = { ...state, id };
  await deps.upsertPersonal({
    recordId: id,
    recordKind: 'txn',
    data: toPersonalData(revived, carried),
  });
  return revived;
}

export interface UndoOutcome {
  /** The state the panel should now hold. */
  readonly state: SavedState;
  /** What was undone, for telemetry. */
  readonly what: 'answer' | 'handoff' | 'correction';
}

/**
 * Take back the newest history entry. Null when there is nothing to undo or a
 * write failed (nothing is changed then; the caller keeps the entry).
 */
export async function undoEntry(entry: UndoEntry, deps: UndoDeps): Promise<UndoOutcome | null> {
  switch (entry.kind) {
    case 'edit': {
      if (!(await deps.persist(entry.previous))) return null;
      return { state: entry.previous, what: entry.what };
    }
    case 'move': {
      // Bring the old entry back first, then remove the new one: nothing is lost if a step fails.
      const revived = await restoreRemoved(entry.previous, deps, entry.carried);
      await removeSaved(entry.current, deps);
      return { state: revived, what: 'correction' };
    }
    case 'lend': {
      // A shared loan is also a debt in a 1:1 group: take that out first, so a
      // failure leaves the loan (and its link) in place to retry, never an
      // orphan debt the other person can still see.
      const shared = deps.sharedLoanExpense?.(entry.loanId) ?? null;
      if (shared) await deps.deleteGroupExpense(shared.groupId, shared.expenseId);
      const revived = await restoreRemoved(entry.previous, deps, entry.carried);
      await deps.deletePersonal(entry.loanId);
      return { state: revived, what: 'handoff' };
    }
    case 'handoff': {
      // Entry back first (same id, same data), then the group expense goes.
      await undoMove(entry.snapshot, {
        restorePersonal: (recordId, data) =>
          deps.upsertPersonal({ recordId, recordKind: 'txn', data: { ...data } }),
        deleteExpense: deps.deleteGroupExpense,
      });
      return { state: entry.previous, what: 'handoff' };
    }
    case 'duplicate': {
      const revived = await restoreRemoved(entry.previous, deps);
      return { state: revived, what: 'handoff' };
    }
  }
}

/** The history step a typed result leaves behind, or null when it changed nothing to take back. */
export function historyEntryFor(
  result: TypedResult,
  carried?: Readonly<Record<string, unknown>>,
): UndoEntry | null {
  if (result.kind === 'answered') {
    return { kind: 'edit', previous: result.previous, what: 'answer' };
  }
  if (result.kind !== 'corrected') return null;
  return result.moved
    ? { kind: 'move', previous: result.previous, current: result.next, carried }
    : { kind: 'edit', previous: result.previous, what: 'correction' };
}

/* ───────────────────────── the Undo / Restore buttons ───────────────────────── */

export type Removal = { readonly ok: true; readonly removed: SavedState } | { readonly ok: false };

/**
 * Undo on the saved bar: remove the expense. Always available (the ring is only
 * a hint of the 6 s window; after it the same link stays, D2). Never throws.
 */
export async function undoSaved(state: SavedState, deps: UndoDeps): Promise<Removal> {
  try {
    await removeSaved(state, deps);
    return { ok: true, removed: state };
  } catch {
    return { ok: false };
  }
}

export type Restoration =
  { readonly ok: true; readonly state: SavedState } | { readonly ok: false };

/** Restore on the "Removed ... Restore" line. Never throws. */
export async function restoreSaved(
  removed: SavedState,
  deps: UndoDeps,
  carried?: Readonly<Record<string, unknown>>,
): Promise<Restoration> {
  try {
    return { ok: true, state: await restoreRemoved(removed, deps, carried) };
  } catch {
    return { ok: false };
  }
}

/** Take back the newest step; returns the shorter history and the state to hold, or null on failure. */
export async function undoLast(
  history: readonly UndoEntry[],
  deps: UndoDeps,
): Promise<{ outcome: UndoOutcome; rest: UndoEntry[] } | null> {
  const { entry, rest } = popHistory(history);
  if (!entry) return null;
  try {
    const outcome = await undoEntry(entry, deps);
    return outcome ? { outcome, rest } : null;
  } catch {
    return null;
  }
}
