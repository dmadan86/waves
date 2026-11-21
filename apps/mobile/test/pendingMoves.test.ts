import { describe, expect, it } from 'vitest';

import { afterCarryFailure, MAX_CARRY_TRIES, moveOutcome } from '@/lib/pendingMoves';

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

describe('afterCarryFailure', () => {
  it('counts failed photo carries and gives up after the limit', () => {
    let move: ReturnType<typeof afterCarryFailure> = {
      cmid: 'm',
      personalId: 'p',
      receiptKey: 'k',
    };
    for (let i = 1; i < MAX_CARRY_TRIES; i += 1) {
      move = afterCarryFailure(move!);
      expect(move?.tries).toBe(i);
    }
    expect(afterCarryFailure(move!)).toBeNull();
  });
});
