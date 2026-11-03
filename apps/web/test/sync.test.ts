import { beforeEach, describe, expect, it, vi } from 'vitest';

import { emptyMirror, MutationKind, SyncTable, type SyncChange } from '@waves/core';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@/lib/waves', () => ({ supabase: { functions: { invoke } } }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ profileId: 'p1' }) }));

const { pull, send, postSync } = await import('../src/lib/sync');

const change = (seq: number, id: string): SyncChange => ({
  table: SyncTable.Groups,
  groupId: 'g1',
  seq,
  row: { id, name: id },
});

beforeEach(() => {
  invoke.mockReset();
});

describe('pull', () => {
  it('keeps asking while the server says hasMore, resuming from the new cursors', async () => {
    invoke
      .mockResolvedValueOnce({
        data: { outcomes: [], changes: [change(1, 'a')], cursors: { g1: 1 }, hasMore: true },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { outcomes: [], changes: [change(2, 'b')], cursors: { g1: 2 }, hasMore: false },
        error: null,
      });
    const mirror = await pull(emptyMirror());
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[0]?.[1].body.cursors).toEqual({});
    expect(invoke.mock.calls[1]?.[1].body.cursors).toEqual({ g1: 1 });
    expect(Object.keys(mirror.tables.groups).sort()).toEqual(['a', 'b']);
    expect(mirror.cursors.g1).toBe(2);
  });

  it('stops when hasMore is stuck and the cursors did not move', async () => {
    invoke.mockResolvedValue({
      data: { outcomes: [], changes: [], cursors: { g1: 5 }, hasMore: true },
      error: null,
    });
    await pull({ cursors: { g1: 5 }, tables: emptyMirror().tables });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

/** Answer a write: echo its clientMutationId back with the given outcome and rows. */
function answerWrite(outcome: Record<string, unknown>, changes: SyncChange[], cursors = {}) {
  invoke.mockImplementation((...args: unknown[]) => {
    const body = (args[1] as { body: { mutations: { clientMutationId: string }[] } }).body;
    return Promise.resolve({
      data: {
        outcomes: [{ clientMutationId: body.mutations[0]?.clientMutationId, ...outcome }],
        changes,
        cursors,
      },
      error: null,
    });
  });
}

describe('send', () => {
  it('throws the server code on a rejected outcome', async () => {
    answerWrite({ status: 'rejected', code: 'COMPANY_SLOT_REQUIRED', message: 'no slot' }, []);
    await expect(
      send(emptyMirror(), MutationKind.GroupCreate, 'g1', { name: 'x' }),
    ).rejects.toMatchObject({ code: 'COMPANY_SLOT_REQUIRED', message: 'no slot' });
  });

  it('merges the changes the write returns', async () => {
    answerWrite({ status: 'applied' }, [change(3, 'new')], { g1: 3 });
    const mirror = await send(emptyMirror(), MutationKind.GroupCreate, 'g1', {});
    expect(mirror.tables.groups.new).toBeDefined();
  });
});

describe('postSync', () => {
  it('turns a failed invoke into a WavesApiError with the body code', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { context: new Response(JSON.stringify({ code: 'RATE_LIMITED', message: 'slow down' }), { status: 429 }) },
    });
    await expect(postSync({})).rejects.toMatchObject({ code: 'RATE_LIMITED', message: 'slow down' });
  });
});
