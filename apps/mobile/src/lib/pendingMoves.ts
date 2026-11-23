/**
 * "Move to family" hands a private entry to a shared group. The private copy is
 * deleted only once the server has accepted the group expense: `mutate()`
 * resolves when the write is queued, and a refused write must never cost the
 * person their entry. Pending moves live on this device until then.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface PendingMove {
  /** The group expense's queued mutation. */
  readonly cmid: string;
  /** The personal record to delete once it lands. */
  readonly personalId: string;
  /** The entry's bill photo (a Personal receipt key), carried to the group expense before the entry goes. */
  readonly receiptKey?: string;
  /** The group expense the photo attaches to. */
  readonly groupId?: string;
  readonly expenseId?: string;
  /** Failed carries so far. */
  readonly tries?: number;
  /** Do not retry before this time (ms since epoch). */
  readonly nextAt?: number;
  /** The photo is on the group expense (or the person chose to go without it). */
  readonly carried?: boolean;
  /** Carrying failed `MAX_CARRY_TRIES` times: the entry and its photo stay, waiting for the person. */
  readonly failed?: boolean;
  /** The queued Personal delete: the photo goes only once the server has acknowledged it. */
  readonly deleteCmid?: string;
}

export const MAX_CARRY_TRIES = 5;

/** 30s, 1m, 2m, 4m ... capped at 15 minutes. */
export function carryBackoffMs(tries: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, tries - 1), 15 * 60_000);
}

/** A failed carry: schedule the next try, or mark the move failed after `MAX_CARRY_TRIES`. */
export function afterCarryFailure(move: PendingMove, now = Date.now()): PendingMove {
  const tries = (move.tries ?? 0) + 1;
  return tries >= MAX_CARRY_TRIES
    ? { ...move, tries, failed: true }
    : { ...move, tries, nextAt: now + carryBackoffMs(tries) };
}

const KEY = 'household.pendingMoves';

// Every change goes through this one queue, as read-modify-write on a fresh read,
// so a move added while the cleanup is busy is never overwritten.
let lock: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.catch(() => undefined);
  return run;
}

async function read(): Promise<PendingMove[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as PendingMove[]) : [];
  } catch {
    return [];
  }
}

export function readPendingMoves(): Promise<PendingMove[]> {
  return locked(read);
}

/** Change the list on a fresh read, inside the lock. */
export function updatePendingMoves(
  change: (moves: readonly PendingMove[]) => readonly PendingMove[],
): Promise<void> {
  return locked(async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify(change(await read())));
  });
}

export const addPendingMove = (move: PendingMove): Promise<void> =>
  updatePendingMoves((moves) => [...moves, move]);

/** Replace (a move) or drop (null) the move with this cmid. */
export const patchPendingMove = (cmid: string, next: PendingMove | null): Promise<void> =>
  updatePendingMoves((moves) => moves.flatMap((m) => (m.cmid !== cmid ? [m] : next ? [next] : [])));

export type MoveOutcome = 'wait' | 'delete' | 'keep';

/**
 * Still queued and not refused: wait. Refused: keep the private entry and stop
 * tracking. Gone from the queue (accepted): delete the private copy.
 */
export function moveOutcome(
  move: PendingMove,
  queue: readonly { clientMutationId: string; rejection?: unknown }[],
): MoveOutcome {
  const item = queue.find((q) => q.clientMutationId === move.cmid);
  if (!item) return 'delete';
  return item.rejection ? 'keep' : 'wait';
}

export type MoveStep = 'idle' | 'drop' | 'carry' | 'delete' | 'finish';

/**
 * What the cleanup does with a move now. `finish`: the Personal delete was
 * acknowledged, so the source photo may go. `idle`: waiting (queue, backoff, or
 * failed and waiting for the person).
 */
export function moveStep(
  move: PendingMove,
  queue: readonly { clientMutationId: string; rejection?: unknown }[],
  now: number,
): MoveStep {
  if (move.deleteCmid) {
    const item = queue.find((q) => q.clientMutationId === move.deleteCmid);
    return !item ? 'finish' : item.rejection ? 'drop' : 'idle';
  }
  const outcome = moveOutcome(move, queue);
  if (outcome === 'keep') return 'drop';
  if (outcome === 'wait' || move.failed) return 'idle';
  if (move.receiptKey && !move.carried) return (move.nextAt ?? 0) > now ? 'idle' : 'carry';
  return 'delete';
}
