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
}

const KEY = 'household.pendingMoves';

export async function readPendingMoves(): Promise<PendingMove[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as PendingMove[]) : [];
  } catch {
    return [];
  }
}

export async function writePendingMoves(moves: readonly PendingMove[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(moves));
}

export async function addPendingMove(move: PendingMove): Promise<void> {
  await writePendingMoves([...(await readPendingMoves()), move]);
}

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
