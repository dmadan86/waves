import { describe, expect, it, vi } from 'vitest';
import { decodeTxn } from '@waves/core';

import {
  HISTORY_MAX,
  UNDO_RING_MS,
  popHistory,
  pushHistory,
  restoreSaved,
  ringFraction,
  undoLast,
  undoPhase,
  undoSaved,
  type UndoDeps,
  type UndoEntry,
} from '@/lib/assistantUndo';
import type { SavedState } from '@/lib/followUpApply';

const personal = (over: Partial<SavedState> = {}): SavedState => ({
  kind: 'personal',
  id: 'p1',
  groupId: null,
  description: 'Lunch',
  amount: 800000n,
  currency: 'INR',
  category: 'food',
  categoryStated: false,
  date: '2026-10-19',
  notes: null,
  place: 'Blue Tokai',
  location: null,
  paymentMethod: 'upi',
  payers: null,
  hasReceipt: false,
  reimbursable: false,
  participants: [],
  ...over,
});
const group = (over: Partial<SavedState> = {}): SavedState =>
  personal({
    kind: 'group',
    id: 'e1',
    groupId: 'g1',
    payers: { m1: 800000n },
    participants: ['m1'],
    ...over,
  });

function fakeDeps(over: Partial<UndoDeps> = {}) {
  const calls: string[] = [];
  const deps: UndoDeps = {
    deleteGroupExpense: vi.fn(async (g: string, id: string) => void calls.push(`delG ${g} ${id}`)),
    restoreGroupExpense: vi.fn(async (g: string, id: string) => void calls.push(`resG ${g} ${id}`)),
    deletePersonal: vi.fn(async (id: string) => void calls.push(`delP ${id}`)),
    upsertPersonal: vi.fn(async (i) => void calls.push(`upP ${i.recordId}`)),
    persist: vi.fn(async (s: SavedState) => {
      calls.push(`persist ${s.id} ${s.amount}`);
      return true;
    }),
    newId: () => 'fresh',
    ...over,
  };
  return { deps, calls };
}

describe('undo window (D2)', () => {
  it('CR-26a a 6 s ring, then a plain link that never goes away', () => {
    expect(UNDO_RING_MS).toBe(6000);
    expect(undoPhase(0)).toBe('ring');
    expect(undoPhase(5999)).toBe('ring');
    expect(undoPhase(6000)).toBe('link');
    expect(undoPhase(10 * 60_000)).toBe('link');
    expect(ringFraction(0)).toBe(1);
    expect(ringFraction(3000)).toBeCloseTo(0.5);
    expect(ringFraction(60_000)).toBe(0);
  });
});

describe('Undo and Restore on the saved bar (CR-26, MC-SB)', () => {
  it('CR-26 undo of a group expense soft-deletes it through the delete hook', async () => {
    const { deps, calls } = fakeDeps();
    const out = await undoSaved(group(), deps);
    expect(out.ok).toBe(true);
    expect(calls).toEqual(['delG g1 e1']);
  });

  it('CR-26b undo of a personal entry deletes the record', async () => {
    const { deps, calls } = fakeDeps();
    expect((await undoSaved(personal(), deps)).ok).toBe(true);
    expect(calls).toEqual(['delP p1']);
  });

  it('MC-SB-01 undo after the ring ran out still deletes (the link stays, D2)', async () => {
    const { deps, calls } = fakeDeps();
    expect(undoPhase(30_000)).toBe('link');
    expect((await undoSaved(group(), deps)).ok).toBe(true);
    expect(calls).toEqual(['delG g1 e1']);
  });

  it('MC-SB-01b a failed delete reports failure and the caller keeps the expense', async () => {
    const { deps } = fakeDeps({
      deleteGroupExpense: vi.fn(async () => Promise.reject(new Error('offline'))),
    });
    expect(await undoSaved(group(), deps)).toEqual({ ok: false });
  });

  it('MC-SB-02 Restore of a group expense uses the restore hook and keeps its id', async () => {
    const { deps, calls } = fakeDeps();
    const out = await restoreSaved(group(), deps);
    expect(out).toEqual({ ok: true, state: group() });
    expect(calls).toEqual(['resG g1 e1']);
  });

  it('MC-SB-02b Restore of a personal entry writes it again, carried fields kept, under a new id', async () => {
    const upsertPersonal = vi.fn(async () => undefined);
    const { deps } = fakeDeps({ upsertPersonal });
    const out = await restoreSaved(personal(), deps, { futureField: 'keep-me' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.state.id).toBe('fresh');
    expect(upsertPersonal).toHaveBeenCalledTimes(1);
    const call = upsertPersonal.mock.calls[0] as unknown as [
      { recordId: string; recordKind: string; data: Record<string, unknown> },
    ];
    expect(call[0].recordId).toBe('fresh');
    expect(call[0].recordKind).toBe('txn');
    expect(call[0].data.futureField).toBe('keep-me');
    const decoded = decodeTxn('fresh', call[0].data);
    expect(decoded.amount).toBe(800000n);
    expect(decoded.place).toBe('Blue Tokai');
    expect(decoded.paymentMethod).toBe('upi');
  });

  it('MC-SB-02c a failed restore reports failure', async () => {
    const { deps } = fakeDeps({
      restoreGroupExpense: vi.fn(async () => Promise.reject(new Error('x'))),
    });
    expect(await restoreSaved(group(), deps)).toEqual({ ok: false });
  });
});

describe('history (CR-27)', () => {
  const entry = (n: number): UndoEntry => ({
    kind: 'edit',
    previous: personal({ amount: BigInt(n) }),
    what: 'answer',
  });

  it('CR-27a keeps the last five steps only', () => {
    let history: UndoEntry[] = [];
    for (let i = 1; i <= 8; i++) history = pushHistory(history, entry(i));
    expect(history).toHaveLength(HISTORY_MAX);
    expect(HISTORY_MAX).toBe(5);
    expect((history[0] as { previous: SavedState }).previous.amount).toBe(4n);
  });

  it('CR-27b pop returns the newest and the rest, and is safe when empty', () => {
    const history = pushHistory(pushHistory([], entry(1)), entry(2));
    const { entry: top, rest } = popHistory(history);
    expect((top as { previous: SavedState }).previous.amount).toBe(2n);
    expect(rest).toHaveLength(1);
    expect(popHistory([])).toEqual({ entry: null, rest: [] });
  });

  it('CR-27 undoing the last answer persists the previous state and pops the history', async () => {
    const before = personal({ place: null });
    const { deps, calls } = fakeDeps();
    const history = pushHistory([], { kind: 'edit', previous: before, what: 'answer' });
    const out = await undoLast(history, deps);
    expect(out?.outcome).toEqual({ state: before, what: 'answer' });
    expect(out?.rest).toEqual([]);
    expect(calls).toEqual(['persist p1 800000']);
  });

  it('CR-27c a failed persist keeps the entry for another try', async () => {
    const { deps } = fakeDeps({ persist: vi.fn(async () => false) });
    const history = pushHistory([], { kind: 'edit', previous: personal(), what: 'correction' });
    expect(await undoLast(history, deps)).toBeNull();
    expect(history).toHaveLength(1);
  });

  it('CR-27d nothing to undo is null', async () => {
    expect(await undoLast([], fakeDeps().deps)).toBeNull();
  });
});

describe('undoing a move and a hand-off (CR-28)', () => {
  it('CR-28 undo of a lend deletes the loan and brings the spend back under a new id', async () => {
    const { deps, calls } = fakeDeps();
    const history = pushHistory([], { kind: 'lend', previous: personal(), loanId: 'loan-7' });
    const out = await undoLast(history, deps);
    expect(out?.outcome.what).toBe('handoff');
    expect(out?.outcome.state.id).toBe('fresh');
    expect(calls).toEqual(['upP fresh', 'delP loan-7']);
  });

  it('CR-28b undo of "same, remove mine" restores my group expense', async () => {
    const { deps, calls } = fakeDeps();
    const history = pushHistory([], { kind: 'duplicate', previous: group() });
    const out = await undoLast(history, deps);
    expect(out?.outcome.state).toEqual(group());
    expect(calls).toEqual(['resG g1 e1']);
  });

  it('CR-28c undo of a move to a group brings the personal entry back first, then removes the new one', async () => {
    const { deps, calls } = fakeDeps();
    const history = pushHistory([], {
      kind: 'move',
      previous: personal(),
      current: group({ id: 'new-e', groupId: 'g2' }),
    });
    const out = await undoLast(history, deps);
    expect(out?.outcome.state.kind).toBe('personal');
    expect(calls).toEqual(['upP fresh', 'delG g2 new-e']);
  });

  it('CR-28d undo of a move out of a group restores the group expense and deletes the personal copy', async () => {
    const { deps, calls } = fakeDeps();
    const history = pushHistory([], {
      kind: 'move',
      previous: group(),
      current: personal({ id: 'new-p' }),
    });
    await undoLast(history, deps);
    expect(calls).toEqual(['resG g1 e1', 'delP new-p']);
  });

  it('CR-28e if the restore step fails nothing is removed', async () => {
    const { deps, calls } = fakeDeps({
      upsertPersonal: vi.fn(async () => Promise.reject(new Error('x'))),
    });
    const history = pushHistory([], { kind: 'lend', previous: personal(), loanId: 'loan-7' });
    expect(await undoLast(history, deps)).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('undo of a shared loan and of a hand-off (CR-28)', () => {
  it('CR-28f undo of a shared lend removes the 1:1 group debt first, then restores the entry and drops the loan', async () => {
    const { deps, calls } = fakeDeps({
      sharedLoanExpense: (id) => (id === 'loan-7' ? { groupId: 'g9', expenseId: 'e9' } : null),
    });
    const history = pushHistory([], { kind: 'lend', previous: personal(), loanId: 'loan-7' });
    const done = await undoLast(history, deps);
    expect(done?.outcome.what).toBe('handoff');
    expect(calls).toEqual(['delG g9 e9', 'upP fresh', 'delP loan-7']);
  });

  it('CR-28g a private lend never touches a group, and a failed group delete keeps the loan', async () => {
    const plain = fakeDeps({ sharedLoanExpense: () => null });
    await undoLast(
      pushHistory([], { kind: 'lend', previous: personal(), loanId: 'l' }),
      plain.deps,
    );
    expect(plain.calls).toEqual(['upP fresh', 'delP l']);

    const failing = fakeDeps({
      sharedLoanExpense: () => ({ groupId: 'g9', expenseId: 'e9' }),
      deleteGroupExpense: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    const out = await undoLast(
      pushHistory([], { kind: 'lend', previous: personal(), loanId: 'l' }),
      failing.deps,
    );
    expect(out).toBeNull();
    expect(failing.calls).toEqual([]);
  });

  it('CR-28h undo of a split / move-to-trip hand-off restores the entry under its own id first, then deletes the group expense', async () => {
    const { deps, calls } = fakeDeps();
    const upsert = vi.mocked(deps.upsertPersonal);
    const history = pushHistory([], {
      kind: 'handoff',
      previous: personal(),
      snapshot: {
        personalId: 'p1',
        data: { kind: 'expense', amount: '8000.00', place: 'x' },
        groupId: 'g1',
        expenseId: 'e1',
      },
    });
    const done = await undoLast(history, deps);
    expect(calls).toEqual(['upP p1', 'delG g1 e1']);
    expect(upsert.mock.calls[0]?.[0].data).toMatchObject({ place: 'x' });
    expect(done?.outcome.state.id).toBe('p1');
  });

  it('CR-28i if the entry cannot be restored the group expense is left alone', async () => {
    const { deps, calls } = fakeDeps({
      upsertPersonal: vi.fn(async () => {
        throw new Error('nope');
      }),
    });
    const out = await undoLast(
      pushHistory([], {
        kind: 'handoff',
        previous: personal(),
        snapshot: { personalId: 'p1', data: {}, groupId: 'g1', expenseId: 'e1' },
      }),
      deps,
    );
    expect(out).toBeNull();
    expect(calls).toEqual([]);
  });
});
