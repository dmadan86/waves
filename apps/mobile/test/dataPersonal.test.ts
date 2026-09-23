/**
 * The personal ledger (A48), read and written through the mirror.
 *
 * The hooks here are thin: they read the mirror and queue from `useSync`, fold
 * them with the core materialiser, and write by enqueueing a mutation. So they
 * are run as plain functions — React's `useMemo` and React Query's
 * `useMutation` are stood in for by their identity — and what is checked is
 * what the screen would see and what would be written to the queue.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  emptyMirror,
  encodeBudget,
  encodeLoan,
  encodeRecurring,
  encodeTxn,
  MutationKind,
  personalScope,
  type MirrorState,
  type QueuedMutation,
} from '@waves/core';

import type { UpsertPersonalInput } from '@/data/personal';

const state = vi.hoisted(() => ({
  mirror: null as unknown,
  queue: [] as unknown[],
  session: null as { user: { id: string } } | null,
  mutate: vi.fn(async () => undefined),
}));

vi.mock('react', () => ({ useMemo: (fn: () => unknown) => fn() }));
vi.mock('@tanstack/react-query', () => ({ useMutation: (options: unknown) => options }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'minted-uuid' }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ session: state.session }) }));
vi.mock('@/sync', () => ({
  useSync: () => ({ mirror: state.mirror, queue: state.queue, mutate: state.mutate }),
}));

const personal = await import('@/data/personal');

const OWNER = 'user-1';

type MutationOptions<I, O> = { mutationFn: (input: I) => Promise<O> };

function record(id: string, kind: string, data: Record<string, unknown>, over = {}) {
  return {
    id,
    owner_user_id: OWNER,
    record_kind: kind,
    data,
    created_at: '2026-09-01T00:00:00.000Z',
    deleted_at: null,
    ...over,
  };
}

const TXN_BASE = {
  kind: 'expense' as const,
  amount: 1000n,
  currency: 'INR',
  category: 'food',
  note: null,
  loanId: null,
  recurringId: null,
};

function mirrorWith(rows: ReturnType<typeof record>[]): MirrorState {
  const m = emptyMirror();
  for (const row of rows) (m.tables.personal_records as Record<string, unknown>)[row.id] = row;
  return m;
}

beforeEach(() => {
  state.mirror = emptyMirror();
  state.queue = [];
  state.session = { user: { id: OWNER } };
  state.mutate.mockClear();
});

describe('localIsoDate / todayIso', () => {
  it('reads the local calendar day, zero-padded', () => {
    // Given a local date early in the year, when formatted, then it is the local day
    expect(personal.localIsoDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('todayIso is today’s local date', () => {
    expect(personal.todayIso()).toBe(personal.localIsoDate(new Date()));
  });
});

describe('usePersonalLedger', () => {
  it('is empty when signed out, whatever the mirror holds', () => {
    state.session = null;
    state.mirror = mirrorWith([
      record('t1', 'txn', encodeTxn({ ...TXN_BASE, date: '2026-09-01' })),
    ]);
    expect(personal.usePersonalRecords()).toEqual([]);
    expect(personal.usePersonalRecordIds().size).toBe(0);
    expect(personal.usePersonalLedger()).toEqual({
      txns: [],
      recurrings: [],
      loans: [],
      budgets: [],
    });
  });

  it('decodes every kind, drops unknown kinds and sorts txns newest first', () => {
    // Given one of each kind, an unknown kind and txns out of date order
    state.mirror = mirrorWith([
      record('t-old', 'txn', encodeTxn({ ...TXN_BASE, date: '2026-08-01' })),
      record('t-new', 'txn', encodeTxn({ ...TXN_BASE, date: '2026-09-10' })),
      record('t-mid', 'txn', encodeTxn({ ...TXN_BASE, date: '2026-09-01' })),
      record('t-mid2', 'txn', encodeTxn({ ...TXN_BASE, date: '2026-09-01' })),
      record(
        'r1',
        'recurring',
        encodeRecurring({
          txnKind: 'expense',
          amount: 500n,
          currency: 'INR',
          category: 'rent',
          note: null,
          cadence: 'monthly',
          interval: 1,
          secondDay: null,
          anchorDate: '2026-09-05',
          nextDate: '2026-09-05',
          endDate: null,
          autoPost: true,
          active: true,
        } as never),
      ),
      record(
        'l1',
        'loan',
        encodeLoan({
          direction: 'lent',
          counterpart: 'Ravi',
          principal: 2000n,
          currency: 'INR',
          note: null,
          startDate: '2026-09-01',
          status: 'active',
        } as never),
      ),
      record(
        'b1',
        'budget',
        encodeBudget({ category: 'food', limit: 9000n, currency: 'INR' } as never),
      ),
      record('x1', 'mystery', {}),
      // Somebody else's row never shows
      record('t-other', 'txn', encodeTxn({ ...TXN_BASE, date: '2026-09-20' }), {
        owner_user_id: 'user-2',
      }),
    ]);

    // When the ledger is read
    const ledger = personal.usePersonalLedger();

    // Then each kind is decoded into its own list, txns newest first
    expect(ledger.txns.map((t) => t.id)).toEqual(['t-new', 't-mid', 't-mid2', 't-old']);
    expect(ledger.recurrings.map((r) => r.id)).toEqual(['r1']);
    expect(ledger.loans[0]?.counterpart).toBe('Ravi');
    expect(ledger.budgets[0]?.limit).toBe(9000n);
  });

  it('record ids include tombstones, the live rows do not', () => {
    // Given a live row and a soft-deleted one
    state.mirror = mirrorWith([
      record('live', 'txn', encodeTxn({ ...TXN_BASE, date: '2026-09-01' })),
      record('gone', 'txn', encodeTxn({ ...TXN_BASE, date: '2026-09-01' }), {
        deleted_at: '2026-09-02T00:00:00.000Z',
      }),
    ]);
    // Then the id set remembers the deletion, the list does not show it
    expect([...personal.usePersonalRecordIds()].sort()).toEqual(['gone', 'live']);
    expect(personal.usePersonalRecords().map((r) => r.id)).toEqual(['live']);
  });

  it('shows a queued upsert straight away (offline first)', () => {
    const queued = {
      seq: 1,
      groupId: personalScope(OWNER),
      kind: MutationKind.PersonalUpsert,
      clientMutationId: 'c1',
      clientCreatedAt: '2026-09-03T00:00:00.000Z',
      payload: {
        recordId: 'queued',
        recordKind: 'txn',
        data: encodeTxn({ ...TXN_BASE, date: '2026-09-03' }),
      },
    } as unknown as QueuedMutation;
    state.queue = [queued];
    expect(personal.usePersonalLedger().txns.map((t) => t.id)).toEqual(['queued']);
  });
});

describe('useUpsertPersonalRecord / useDeletePersonalRecord', () => {
  it('mints an id on create and enqueues a personal upsert on the personal scope', async () => {
    const { mutationFn } = personal.useUpsertPersonalRecord() as unknown as MutationOptions<
      UpsertPersonalInput,
      string
    >;
    const id = await mutationFn({ recordKind: 'txn', data: { amount: '1' } });
    expect(id).toBe('minted-uuid');
    expect(state.mutate).toHaveBeenCalledWith(MutationKind.PersonalUpsert, personalScope(OWNER), {
      recordId: 'minted-uuid',
      recordKind: 'txn',
      data: { amount: '1' },
    });
  });

  it('keeps the id it is given on an edit', async () => {
    const { mutationFn } = personal.useUpsertPersonalRecord() as unknown as MutationOptions<
      { recordId?: string; recordKind: 'loan'; data: Record<string, unknown> },
      string
    >;
    await expect(mutationFn({ recordId: 'l1', recordKind: 'loan', data: {} })).resolves.toBe('l1');
  });

  it('deletes by enqueueing a tombstone for the record', async () => {
    const { mutationFn } = personal.useDeletePersonalRecord() as unknown as MutationOptions<
      string,
      string
    >;
    await expect(mutationFn('t1')).resolves.toBe('t1');
    expect(state.mutate).toHaveBeenCalledWith(MutationKind.PersonalDelete, personalScope(OWNER), {
      recordId: 't1',
    });
  });

  it('refuses both writes when signed out, and writes nothing', async () => {
    state.session = null;
    const upsert = personal.useUpsertPersonalRecord() as unknown as MutationOptions<
      { recordKind: 'txn'; data: Record<string, unknown> },
      string
    >;
    const del = personal.useDeletePersonalRecord() as unknown as MutationOptions<string, string>;
    await expect(upsert.mutationFn({ recordKind: 'txn', data: {} })).rejects.toThrow(
      'Sign in first',
    );
    await expect(del.mutationFn('t1')).rejects.toThrow('Sign in first');
    expect(state.mutate).not.toHaveBeenCalled();
  });
});
