import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addPendingMove,
  afterCarryFailure,
  carryBackoffMs,
  MAX_CARRY_TRIES,
  moveOutcome,
  moveStep,
  patchPendingMove,
  readPendingMoves,
  type PendingMove,
} from '@/lib/pendingMoves';

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    // A slow write, so unlocked read-modify-writes would interleave.
    setItem: async (k: string, v: string) => {
      await new Promise((r) => setTimeout(r, 5));
      store.set(k, v);
    },
  },
}));
beforeEach(() => store.clear());

describe('moveOutcome', () => {
  const move = { cmid: 'm1', personalId: 'p1' };
  it('waits while the group write is still queued', () => {
    expect(moveOutcome(move, [{ clientMutationId: 'm1' }])).toBe('wait');
  });
  it('keeps the private entry when the server refused the write', () => {
    expect(moveOutcome(move, [{ clientMutationId: 'm1', rejection: { code: 'x' } }])).toBe('keep');
  });
  it('deletes the private copy once the write has left the queue', () => {
    expect(moveOutcome(move, [{ clientMutationId: 'other' }])).toBe('delete');
  });
});

describe('carry retries', () => {
  it('backs off, then parks the move as failed without giving the entry up', () => {
    let move: PendingMove = { cmid: 'm', personalId: 'p', receiptKey: 'k' };
    for (let i = 1; i < MAX_CARRY_TRIES; i += 1) {
      move = afterCarryFailure(move, 1000);
      expect(move.tries).toBe(i);
      expect(move.failed).toBeUndefined();
      expect(move.nextAt).toBe(1000 + carryBackoffMs(i));
    }
    move = afterCarryFailure(move, 1000);
    expect(move.failed).toBe(true);
    expect(moveStep(move, [], 1e12)).toBe('idle');
  });
});

describe('moveStep', () => {
  const base: PendingMove = { cmid: 'm', personalId: 'p', receiptKey: 'k' };
  it('carries the photo before deleting, once any backoff has passed', () => {
    expect(moveStep(base, [], 0)).toBe('carry');
    expect(moveStep({ ...base, nextAt: 500 }, [], 100)).toBe('idle');
    expect(moveStep({ ...base, carried: true }, [], 0)).toBe('delete');
    expect(moveStep({ cmid: 'm', personalId: 'p' }, [], 0)).toBe('delete');
  });
  it('removes the source photo only after the personal delete is acknowledged', () => {
    const queued = { ...base, carried: true, deleteCmid: 'd' };
    expect(moveStep(queued, [{ clientMutationId: 'd' }], 0)).toBe('idle');
    expect(moveStep(queued, [{ clientMutationId: 'd', rejection: {} }], 0)).toBe('drop');
    expect(moveStep(queued, [], 0)).toBe('finish');
  });
});

describe('pending move storage', () => {
  it('never loses a move added while another update is in flight', async () => {
    await addPendingMove({ cmid: 'a', personalId: 'pa' });
    await Promise.all([
      patchPendingMove('a', { cmid: 'a', personalId: 'pa', tries: 1 }),
      addPendingMove({ cmid: 'b', personalId: 'pb' }),
      addPendingMove({ cmid: 'c', personalId: 'pc' }),
      patchPendingMove('c', null),
    ]);
    const moves = await readPendingMoves();
    expect(moves.map((m) => m.cmid)).toEqual(['a', 'b']);
    expect(moves[0]?.tries).toBe(1);
  });
});
