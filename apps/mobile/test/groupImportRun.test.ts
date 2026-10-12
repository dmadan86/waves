/**
 * The job that writes a reviewed import: one batch id, the same row ids on every
 * attempt, chunks reported as they land, the mirror pulled before it is done.
 * `importIntoGroup` itself (the 250-row chunking against the RPC) is covered in
 * dataApi.test.ts; here the api is a stand-in, so what is checked is what this
 * layer promises.
 */

import { describe, expect, it, vi } from 'vitest';

import type { ImportBatchResult, ImportProgress } from '@/data/api';
import { importSourceFor, rowTotal, runGroupImport } from '@/lib/groupImport/run';
import type { ImportPayload } from '@/lib/groupImport/review';

function payload(expenses: number, settlements = 0): ImportPayload {
  return {
    people: [{ name: 'Asha', memberId: 'm-asha' }],
    expenses: Array.from({ length: expenses }, (_, index) => ({
      clientMutationId: `e-${index}`,
      description: `Expense ${index}`,
      category: null,
      date: '2026-10-01',
      currency: 'INR',
      amount: 100n,
      payers: { Asha: 100n },
      shares: { Asha: 100n },
    })),
    settlements: Array.from({ length: settlements }, (_, index) => ({
      clientMutationId: `s-${index}`,
      from: 'Asha',
      to: 'Ravi',
      currency: 'INR',
      amount: 50n,
      method: 'other',
      status: 'confirmed',
      note: null,
      at: '2026-10-01',
    })),
  };
}

const landed = (expenses: number, settlements: number): ImportBatchResult => ({
  groupId: 'g1',
  batchId: 'b1',
  expenses,
  ghosts: 1,
  settlements,
  settlementsPending: 0,
  members: {},
  totals: { expenses, settlements, ghosts: 1 },
});

function deps(overrides: Partial<Parameters<typeof runGroupImport>[1]> = {}) {
  const calls: Parameters<Parameters<typeof runGroupImport>[1]['write']>[0][] = [];
  const reports: [number, number][] = [];
  const order: string[] = [];
  const base: Parameters<typeof runGroupImport>[1] = {
    write: async (input) => {
      calls.push(input);
      order.push('write');
      const total = input.expenses.length + input.settlements.length;
      // Behave like importIntoGroup: report a chunk at a time.
      const size = input.chunkSize ?? 250;
      for (let done = size; done - size < total; done += size) {
        const reached = Math.min(done, total);
        input.onChunk?.({
          chunk: done / size,
          chunks: Math.ceil(total / size),
          done: reached,
          total,
          result: landed(0, 0),
        } satisfies ImportProgress);
      }
      return landed(input.expenses.length, input.settlements.length);
    },
    pull: async () => {
      order.push('pull');
    },
    report: (done, total) => reports.push([done, total]),
  };
  return { calls, reports, order, deps: { ...base, ...overrides } };
}

describe('runGroupImport', () => {
  it('writes under the batch id it was given and passes the rows through untouched', async () => {
    const { calls, deps: d } = deps();
    const input = {
      groupId: 'g1',
      batchId: 'batch-xyz',
      source: 'csv' as const,
      payload: payload(3, 1),
    };
    await runGroupImport(input, d);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ groupId: 'g1', batchId: 'batch-xyz', source: 'csv' });
    expect(calls[0]!.expenses.map((e) => e.clientMutationId)).toEqual(['e-0', 'e-1', 'e-2']);
    expect(calls[0]!.settlements.map((s) => s.clientMutationId)).toEqual(['s-0']);
  });

  it('sends the same batch and row ids when it is run again, so the retry is a replay', async () => {
    const first = deps();
    const second = deps();
    const input = {
      groupId: 'g1',
      batchId: 'batch-xyz',
      source: 'xlsx' as const,
      payload: payload(2),
    };
    await runGroupImport(input, first.deps);
    await runGroupImport(input, second.deps);
    const ids = (c: (typeof first.calls)[number]) => [
      c.batchId,
      ...c.expenses.map((e) => e.clientMutationId),
    ];
    expect(ids(second.calls[0]!)).toEqual(ids(first.calls[0]!));
  });

  it('reports 0 of N first, then each chunk as it lands, ending at N of N', async () => {
    const { reports, deps: d } = deps();
    await runGroupImport(
      { groupId: 'g1', batchId: 'b', source: 'csv', payload: payload(600), chunkSize: 250 },
      d,
    );
    expect(reports).toEqual([
      [0, 600],
      [250, 600],
      [500, 600],
      [600, 600],
    ]);
  });

  it('pulls the group into the mirror after the write, and reports the totals', async () => {
    const { order, deps: d } = deps();
    const result = await runGroupImport(
      { groupId: 'g1', batchId: 'b', source: 'csv', payload: payload(4, 2) },
      d,
    );
    expect(order).toEqual(['write', 'pull']);
    expect(result).toEqual({ groupId: 'g1', batchId: 'b', expenses: 4, settlements: 2, ghosts: 1 });
  });

  it('is still a success when the pull fails', async () => {
    const { deps: d } = deps({
      pull: async () => {
        throw new Error('offline');
      },
    });
    await expect(
      runGroupImport({ groupId: 'g1', batchId: 'b', source: 'csv', payload: payload(1) }, d),
    ).resolves.toMatchObject({ expenses: 1 });
  });

  it('lets a failed write through, for the store to show or to park offline', async () => {
    const pull = vi.fn();
    const { deps: d } = deps({
      write: async () => {
        throw new Error('network');
      },
      pull,
    });
    await expect(
      runGroupImport({ groupId: 'g1', batchId: 'b', source: 'csv', payload: payload(1) }, d),
    ).rejects.toThrow('network');
    expect(pull).not.toHaveBeenCalled();
  });
});

describe('what a file is called on the server', () => {
  it('names the layout, or else the kind of file', () => {
    expect(importSourceFor('splitwise', 'csv')).toBe('splitwise');
    expect(importSourceFor('waves_csv', 'csv')).toBe('waves_csv');
    expect(importSourceFor('generic', 'xlsx')).toBe('xlsx');
    expect(importSourceFor('generic', 'csv')).toBe('csv');
  });

  it('counts expenses and settlements together', () => {
    expect(rowTotal(payload(3, 2))).toBe(5);
  });
});
