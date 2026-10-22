import { beforeEach, describe, expect, it } from 'vitest';

import {
  forgetMove,
  lastRememberedMove,
  moveAfterSave,
  rememberMove,
  undoMove,
  type MoveSnapshot,
} from '../src/lib/personalHandoff';

const snapshot: MoveSnapshot = {
  personalId: 'p1',
  data: { kind: 'expense', amount: '800000', note: 'dinner', futureField: { keep: 'me' } },
  groupId: 'g1',
  expenseId: 'e1',
};

describe('moving a personal entry into a group (D7)', () => {
  it('saves the group expense first, then deletes the personal entry', async () => {
    const calls: string[] = [];
    const result = await moveAfterSave(
      async () => void calls.push('save'),
      async () => void calls.push('delete'),
    );
    expect(calls).toEqual(['save', 'delete']);
    expect(result).toEqual({ saved: true, removed: true });
  });

  it('waits for the save to finish before it deletes', async () => {
    const calls: string[] = [];
    await moveAfterSave(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        calls.push('save');
      },
      async () => void calls.push('delete'),
    );
    expect(calls).toEqual(['save', 'delete']);
  });

  it('never deletes the personal entry when the group save fails', async () => {
    let deleted = false;
    await expect(
      moveAfterSave(
        async () => {
          throw new Error('offline queue refused');
        },
        async () => {
          deleted = true;
        },
      ),
    ).rejects.toThrow('offline queue refused');
    expect(deleted).toBe(false);
  });

  it('keeps the expense saved when the delete fails, and says the entry stayed', async () => {
    const result = await moveAfterSave(
      async () => undefined,
      async () => {
        throw new Error('delete failed');
      },
    );
    expect(result).toEqual({ saved: true, removed: false });
  });
});

describe('undoing a move', () => {
  it('puts the personal entry back with the same id and data, then deletes the group expense', async () => {
    const calls: unknown[] = [];
    await undoMove(snapshot, {
      restorePersonal: async (id, data) => void calls.push(['restore', id, data]),
      deleteExpense: async (groupId, expenseId) => void calls.push(['delete', groupId, expenseId]),
    });
    expect(calls).toEqual([
      ['restore', 'p1', snapshot.data],
      ['delete', 'g1', 'e1'],
    ]);
  });

  it('restores a copy, so the carried fields are intact and the snapshot is not shared', async () => {
    let restored: Record<string, unknown> = {};
    await undoMove(snapshot, {
      restorePersonal: async (_id, data) => {
        restored = data;
      },
      deleteExpense: async () => undefined,
    });
    expect(restored).toEqual(snapshot.data);
    expect(restored).not.toBe(snapshot.data);
  });

  it('leaves the group expense alone when the restore fails', async () => {
    let deleted = false;
    await expect(
      undoMove(snapshot, {
        restorePersonal: async () => {
          throw new Error('restore failed');
        },
        deleteExpense: async () => {
          deleted = true;
        },
      }),
    ).rejects.toThrow('restore failed');
    expect(deleted).toBe(false);
  });
});

describe('the last move', () => {
  beforeEach(() => forgetMove());
  it('is remembered for an undo and can be forgotten', () => {
    expect(lastRememberedMove()).toBeNull();
    rememberMove(snapshot);
    expect(lastRememberedMove()).toBe(snapshot);
    forgetMove();
    expect(lastRememberedMove()).toBeNull();
  });
});
