import { describe, it, expect, vi } from 'vitest';
import * as inlineAll from '../src/lib/assistantInline';
import { planMove } from '../src/lib/assistantCorrections';
import { runMove } from '../src/lib/assistantMove';
import { undoEntry } from '../src/lib/assistantUndo';
import type { SavedState } from '../src/lib/followUpApply';
import type { AgentLocalData } from '../src/lib/voiceAgentPlan';

const inline: Record<string, any> & typeof inlineAll = inlineAll;
const saved: SavedState = {
  kind: 'personal',
  id: 'p',
  groupId: null,
  description: 'Dinner',
  amount: 10001n,
  currency: 'INR',
  category: 'food',
  categoryStated: true,
  date: '2026-10-01',
  notes: null,
  place: null,
  location: null,
  paymentMethod: 'cash',
  payers: null,
  participants: [],
  hasReceipt: false,
  reimbursable: false,
};
const local: AgentLocalData = {
  groups: [
    {
      id: 'g',
      name: 'Trip',
      currency: 'INR',
      members: [
        { id: 'me', name: 'Me', isViewer: true, avatarUrl: null },
        { id: 'r', name: 'Ravi', isViewer: false, avatarUrl: null },
        { id: 'x', name: 'X', isViewer: false, avatarUrl: null },
      ],
    },
    { id: 'absent', name: 'Absent', currency: 'INR', members: [] },
  ],
};
const group: SavedState = {
  ...saved,
  kind: 'group',
  id: 'old',
  groupId: 'g',
  participants: ['me', 'r'],
  payers: { r: 10001n },
};
const draft = {
  items: [
    { label: 'A', total: 3000n },
    { label: 'B', total: 6000n },
  ],
  charges: 1001n,
};
const claims = { 0: ['me'], 1: ['r'] };
function deferred() {
  let resolve!: (v?: any) => void;
  const promise = new Promise<any>((r) => (resolve = r));
  return { promise, resolve };
}

describe('inline pure flows', () => {
  it('IN-U-01 runOnce locks pending work and releases after success, throws and sequential calls', async () => {
    const lock = { current: false },
      d = deferred(),
      fn = vi.fn(() => d.promise);
    const first = inline.runOnce(lock, fn);
    expect(await inline.runOnce(lock, fn)).toEqual({ ran: false });
    expect(fn).toHaveBeenCalledTimes(1);
    d.resolve(7);
    expect(await first).toEqual({ ran: true, value: 7 });
    expect(lock.current).toBe(false);
    await expect(
      inline.runOnce(lock, async () => {
        throw Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(lock.current).toBe(false);
    expect(await inline.runOnce(lock, async () => 1)).toEqual({ ran: true, value: 1 });
    expect(await inline.runOnce(lock, async () => 2)).toEqual({ ran: true, value: 2 });
  });
  it.each([
    ['attachReceipt', 'attached'],
    ['shareLoanInline', 'shared'],
    ['recordInline', 'recorded'],
  ] as const)('IN-U-02 %s handles failure, same-function retry and busy', async (name, success) => {
    const lock = { current: false },
      fn = vi.fn().mockRejectedValueOnce(Error()).mockResolvedValue(undefined);
    expect(await inline[name](lock, fn)).toBe('failed');
    expect(await inline[name](lock, fn)).toBe(success);
    const d = deferred();
    fn.mockImplementation(() => d.promise);
    const first = inline[name](lock, fn);
    expect(await inline[name](lock, fn)).toBe('busy');
    expect(fn).toHaveBeenCalledTimes(3);
    d.resolve();
    expect(await first).toBe(success);
  });
  it('IN-U-03 split includes viewer, chosen group members only, exact odd shares and viewer payer', () => {
    for (const plan of [
      inline.planSplitMove(saved, local, 'g', ['r', 'stranger'], 'new'),
      planMove(saved, 'g', local, 'new', ['r', 'stranger']),
    ]) {
      expect(plan?.kind).toBe('toGroup');
      if (plan?.kind !== 'toGroup') throw Error('missing');
      expect(plan.write.participants).toEqual(['me', 'r']);
      expect(plan.write.payers).toEqual({ me: 10001n });
      expect(Object.values(plan.write.expectedShares).reduce((a, b) => a + b, 0n)).toBe(10001n);
    }
    expect(inline.planSplitMove(group, local, 'g', ['r'], 'new')).toBeNull();
    for (const id of ['missing', 'absent'])
      expect(inline.planSplitMove(saved, local, id, ['r'], 'new')).toBeNull();
  });
  it('IN-U-04 group and people choices and locked self selection', () => {
    expect(inline.groupChoices(local, 'g')).toEqual([{ id: 'g', name: 'Trip' }]);
    const people = inline.peopleIn(local, 'g');
    expect(inline.peopleIn(local, 'missing')).toEqual([]);
    expect(inline.togglePerson(['me'], 'me', people)).toEqual(['me']);
    expect(inline.togglePerson(['me'], 'me', people, false)).toEqual([]);
    expect(inline.togglePerson(['me'], 'r', people)).toEqual(['me', 'r']);
  });
  it('IN-U-05 attendance requires changed nonempty group selection', () => {
    expect(inline.planAttendance(saved, ['r'])).toBeNull();
    expect(inline.planAttendance(group, [])).toBeNull();
    expect(inline.planAttendance(group, ['r', 'me', 'r'])).toBeNull();
    expect(inline.planAttendance(group, ['r'])).toEqual({ ...group, participants: ['r'] });
  });
  it('IN-U-06 receipt draft rejects empty/over-total lines and computes remaining charges', () => {
    const parsed = { currency: 'INR', items: [], grandTotal: 10001 } as any;
    expect(inline.itemizeDraftFor(parsed, 10001n)).toEqual({ ok: false, reason: 'noItems' });
    parsed.items = [{ label: 'A', total: 11000 }];
    expect(inline.itemizeDraftFor(parsed, 10001n)).toEqual({ ok: false, reason: 'mismatch' });
    parsed.items = [{ label: 'A', total: 9000 }];
    expect(inline.itemizeDraftFor(parsed, 10001n)).toEqual({
      ok: true,
      draft: { items: [{ label: 'A', total: 9000n }], charges: 1001n },
    });
  });
  it('IN-U-07 claims toggle immutably and unclaimed totals remain null', () => {
    const c = inline.toggleClaim({}, 0, 'me');
    expect(c).toEqual({ 0: ['me'] });
    expect(inline.toggleClaim(c, 0, 'me')).toEqual({ 0: [] });
    expect(c).toEqual({ 0: ['me'] });
    expect(inline.unclaimedCount(draft, c)).toBe(1);
    expect(inline.claimants({ 0: ['me', 'r'], 1: ['r'] }, draft)).toEqual(['me', 'r']);
    expect(inline.itemizeTotals(draft, c, 10001n, 'INR', 's')).toBeNull();
  });
  it('IN-U-08 itemized totals prorate extras, split shared lines, conserve every minor unit deterministically', () => {
    const exact = { ...draft, charges: 900n };
    expect(inline.itemizeTotals(exact, claims, 9900n, 'INR', 's')).toEqual(
      new Map([
        ['me', 3300n],
        ['r', 6600n],
      ]),
    );
    const shared = { 0: ['me', 'r'], 1: ['r'] };
    const totals = inline.itemizeTotals(draft, shared, 10001n, 'INR', 's')!;
    expect([...totals.values()].reduce((a, b) => a + b, 0n)).toBe(10001n);
    expect(totals.get('me')).toBeGreaterThanOrEqual(1666n);
    expect(totals.get('me')).toBeLessThanOrEqual(1667n);
    expect(inline.itemizeTotals(draft, shared, 10001n, 'INR', 's')).toEqual(totals);
  });
  it('IN-U-09 itemize replacement keeps payer, receipt and only claimers', () => {
    const plan = inline.planItemize(group, draft, claims, local, 'receipt', 'new')!;
    expect(plan).toMatchObject({
      kind: 'toGroup',
      groupId: 'g',
      next: { id: 'new' },
      write: {
        receiptId: 'receipt',
        splitParams: { kind: 'itemized' },
        payers: { r: 10001n },
        participants: ['me', 'r'],
      },
    });
    expect(inline.planItemize(group, draft, {}, local, 'receipt', 'new')).toBeNull();
    expect(inline.planItemize(saved, draft, claims, local, 'receipt', 'new')).toBeNull();
    expect(
      inline.planItemize({ ...group, groupId: 'absent' }, draft, claims, local, 'receipt', 'new'),
    ).toBeNull();
  });
  it('IN-U-10 lentLoan uses saved money and date and cleans counterpart', () => {
    expect(inline.lentLoan({ id: 'loan', person: '  Ravi  ', saved })).toEqual({
      id: 'loan',
      direction: 'lent',
      counterpart: 'Ravi',
      principal: 10001n,
      currency: 'INR',
      note: null,
      startDate: saved.date,
      status: 'active',
    });
  });
  it('IN-U-11 settlement ignores deleted/foreign bills and allocates oldest first', () => {
    const bill = (id: string, date: string, extra = {}) => ({
      id,
      date,
      amount: 100n,
      currency: 'INR',
      shares: { r: 100n },
      payers: { me: 100n },
      ...extra,
    });
    const rows = [
      bill('new', '2026-10-02'),
      bill('old', '2026-10-01'),
      bill('deleted', '2026-01-01', { deletedAt: 'x' }),
      bill('foreign', '2026-01-01', { currency: 'USD' }),
    ];
    const rs = inline.receivablesFor(rows as any, 'r', 'me', 'INR');
    expect(rs.map((r) => r.expenseId)).toEqual(['new', 'old']);
    const tr = { from: 'r', to: 'me', currency: 'INR', amount: 150n };
    const write = inline.settlementFor('g', tr, rs, 'cash')!;
    expect(write.allocations).toEqual(
      expect.arrayContaining([
        { expenseId: 'old', amount: 100n },
        { expenseId: 'new', amount: 50n },
      ]),
    );
    expect(inline.settlementFor('g', { ...tr, amount: 0n }, rs, 'cash')).toBeNull();
  });
  it('IN-U-12 transaction filters combine and sort newest first; preview is five', () => {
    const txns = Array.from({ length: 7 }, (_, i) => ({
      id: String(i),
      kind: 'expense',
      category: 'food',
      date: `2026-10-0${i + 1}`,
    }));
    txns.push(
      { id: 'income', kind: 'income', category: 'food', date: '2026-10-05' },
      { id: 'other', kind: 'expense', category: 'travel', date: '2026-10-05' },
    );
    expect(
      inline
        .matchingTransactions(txns as any, {
          kind: 'expense',
          category: 'food',
          from: '2026-10-03',
          to: '2026-10-06',
        })
        .map((t) => t.id),
    ).toEqual(['5', '4', '3', '2']);
    expect(inline.MATCH_PREVIEW).toBe(5);
    expect(inline.visibleMatches(txns, false)).toHaveLength(5);
    expect(inline.visibleMatches(txns, true)).toEqual(txns);
  });
  it.each([false, true])(
    'IN-U-13 D7 failed %s destination/remove is resumable without a duplicate destination',
    async (removeFails) => {
      const ref = { current: null } as any,
        plan = inline.planSplitMove(saved, local, 'g', ['r'], 'new')!;
      const order: string[] = [];
      const io = {
        writeDestination: vi.fn(async () => {
          order.push('write');
          if (!removeFails) throw Error();
        }),
        removeSource: vi.fn(async () => {
          order.push('remove');
          if (removeFails) throw Error();
        }),
        removeDestination: vi.fn(),
        completed: vi.fn(),
      };
      expect(await runMove(ref, plan, saved, io)).toBe(false);
      expect(ref.current.destWritten).toBe(removeFails);
      if (!removeFails) expect(io.removeSource).not.toHaveBeenCalled();
      io.writeDestination.mockImplementation(async () => {
        order.push('write');
      });
      io.removeSource.mockImplementation(async () => {
        order.push('remove');
      });
      expect(await runMove(ref, plan, saved, io)).toBe(true);
      expect(io.writeDestination).toHaveBeenCalledTimes(removeFails ? 1 : 2);
      expect(ref.current).toBeNull();
      expect(io.completed).toHaveBeenCalledOnce();
    },
  );
  it.each(['personal', 'itemize'])(
    'IN-U-14 %s move writes before removal and undo restores before destination deletion',
    async (kind) => {
      const previous = kind === 'personal' ? saved : group;
      const plan =
        kind === 'personal'
          ? inline.planSplitMove(saved, local, 'g', ['r'], 'new')!
          : inline.planItemize(group, draft, claims, local, 'receipt', 'new')!;
      const order: string[] = [];
      await runMove({ current: null }, plan, previous, {
        writeDestination: async () => {
          order.push('write');
        },
        removeSource: async () => {
          order.push('remove');
        },
        removeDestination: async () => {},
        completed: () => {},
      });
      expect(order).toEqual(['write', 'remove']);
      order.length = 0;
      const deps = {
        newId: () => 'restored',
        persist: vi.fn(),
        deletePersonal: vi.fn(),
        upsertPersonal: vi.fn(async () => {
          order.push('restorePersonal');
        }),
        restoreGroupExpense: vi.fn(async () => {
          order.push('restoreGroup');
        }),
        deleteGroupExpense: vi.fn(async () => {
          order.push('deleteGroup');
        }),
      };
      const entry = { kind: 'move' as const, previous, current: plan.next };
      await undoEntry(entry, deps);
      expect(order).toEqual([
        kind === 'personal' ? 'restorePersonal' : 'restoreGroup',
        'deleteGroup',
      ]);
      const fail = {
        ...deps,
        upsertPersonal: vi.fn().mockRejectedValue(Error('restore')),
        restoreGroupExpense: vi.fn().mockRejectedValue(Error('restore')),
        deleteGroupExpense: vi.fn(),
      };
      await expect(undoEntry({ ...entry }, fail)).rejects.toThrow('restore');
      expect(fail.deleteGroupExpense).not.toHaveBeenCalled();
    },
  );
});

it('IN-U-15 handoff undo restores carried personal data before group deletion; edit undo persists previous state', async () => {
  const order: string[] = [];
  const deps = {
    newId: () => 'restored',
    persist: vi.fn().mockResolvedValue(true),
    deletePersonal: vi.fn(),
    upsertPersonal: vi.fn(async () => {
      order.push('restore');
    }),
    restoreGroupExpense: vi.fn(),
    deleteGroupExpense: vi.fn(async () => {
      order.push('delete');
    }),
  };
  const entry = {
    kind: 'handoff' as const,
    previous: saved,
    snapshot: { personalId: 'p', data: { custom: 'kept' }, groupId: 'g', expenseId: 'new' },
  };
  expect(await undoEntry(entry, deps)).toEqual({ state: saved, what: 'handoff' });
  expect(deps.upsertPersonal).toHaveBeenCalledWith({
    recordId: 'p',
    recordKind: 'txn',
    data: { custom: 'kept' },
  });
  expect(order).toEqual(['restore', 'delete']);
  deps.upsertPersonal.mockRejectedValueOnce(Error('restore'));
  deps.deleteGroupExpense.mockClear();
  await expect(undoEntry({ ...entry }, deps)).rejects.toThrow('restore');
  expect(deps.deleteGroupExpense).not.toHaveBeenCalled();
  expect(await undoEntry({ kind: 'edit', previous: group, what: 'answer' }, deps)).toEqual({
    state: group,
    what: 'answer',
  });
  expect(deps.persist).toHaveBeenCalledWith(group);
});
