/**
 * Just enough of React, React Query and the sync context to call a data hook
 * as a plain function under node.
 *
 * The hooks in `src/data/hooks.ts` are thin: each one reads the mirror through
 * `useSync`, derives something with `useMemo`, and either returns it or hands a
 * `mutationFn` to React Query. None of that needs a renderer to be exercised —
 * `useMemo` can simply run its factory, `useMutation` can hand back the options
 * it was given (so a test calls `mutationFn` itself), and `useRef` only has to
 * survive between two "renders" of the same hook. Effects are collected and run
 * after the hook returns, the way React commits them.
 *
 * Each test file mocks `react`, `@tanstack/react-query` and `@/sync` to the
 * objects exported here (vi.mock has to live in the test file to be hoisted).
 */

import { vi } from 'vitest';

import {
  emptyMirror,
  enqueue,
  reconcile,
  type MirrorRow,
  type MirrorState,
  type MutationEnvelope,
  type QueuedMutation,
  type SyncChange,
  type SyncTable,
} from '@waves/core';

type Effect = () => void | (() => void);

const slots = {
  refs: [] as { current: unknown }[],
  refIndex: 0,
  effects: [] as Effect[],
  cleanups: [] as (() => void)[],
};

export const fakeReact = {
  useMemo: <T>(factory: () => T): T => factory(),
  useCallback: <T>(fn: T): T => fn,
  useState: <T>(init: T | (() => T)): [T, (next: T) => void] => [
    typeof init === 'function' ? (init as () => T)() : init,
    () => undefined,
  ],
  useRef: <T>(init: T): { current: T } => {
    const index = slots.refIndex++;
    slots.refs[index] ??= { current: init };
    return slots.refs[index] as { current: T };
  },
  useEffect: (effect: Effect): void => {
    slots.effects.push(effect);
  },
};

/** One render: refs persist from the previous render, effects run after. */
export function render<T>(hook: () => T): T {
  slots.refIndex = 0;
  slots.effects = [];
  const out = hook();
  for (const effect of slots.effects) {
    const cleanup = effect();
    if (typeof cleanup === 'function') slots.cleanups.push(cleanup);
  }
  return out;
}

/** Unmount: run every cleanup the effects returned. */
export function unmount(): void {
  for (const cleanup of slots.cleanups.splice(0)) cleanup();
}

/** Forget every ref, as a fresh mount would. */
export function resetHarness(): void {
  slots.refs = [];
  slots.refIndex = 0;
  slots.effects = [];
  slots.cleanups = [];
}

// ─────────────────────────────────────────────── React Query ──

export interface FakeQueryState {
  data: unknown;
  isFetching: boolean;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

export const query = {
  state: {
    data: undefined,
    isFetching: false,
    dataUpdatedAt: 0,
    refetch: vi.fn(),
  } as FakeQueryState,
  client: { invalidateQueries: vi.fn(() => Promise.resolve()) },
};

/** What `useQuery` was called with, alongside the configured result. */
export interface CapturedQuery {
  options: {
    queryKey: readonly unknown[];
    queryFn: () => Promise<unknown>;
    enabled?: boolean;
    staleTime?: number;
  };
  data: unknown;
  isFetching: boolean;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

/** What `useMutation` was called with — the test drives it directly. */
export interface CapturedMutation<I = unknown, O = unknown> {
  mutationFn: (input: I) => Promise<O>;
  onSuccess?: () => unknown;
}

export const fakeReactQuery = {
  useQuery: (options: CapturedQuery['options']) => ({ ...query.state, options }),
  useMutation: (options: CapturedMutation) => options,
  useQueryClient: () => query.client,
};

// ─────────────────────────────────────────────────── sync ──

export const sync = {
  mirror: emptyMirror() as MirrorState,
  queue: [] as QueuedMutation[],
  hydrated: true,
  status: 'idle' as string,
  hasSynced: true,
  flush: vi.fn(() => Promise.resolve()),
  mutate: vi.fn((..._args: unknown[]) => Promise.resolve()),
  forgetGroup: vi.fn((_groupId: string) => Promise.resolve()),
};

export const syncModule = {
  lastSyncedAt: null as string | null,
  engineFlush: vi.fn((_options?: unknown) => Promise.resolve()),
};

export const fakeSync = {
  useSync: () => sync,
  useLastSyncedAt: () => syncModule.lastSyncedAt,
  syncEngine: {
    flush: (options?: unknown) => syncModule.engineFlush(options),
  },
};

export function resetSync(): void {
  sync.mirror = emptyMirror();
  sync.queue = [];
  sync.hydrated = true;
  sync.status = 'idle';
  sync.hasSynced = true;
  sync.flush.mockClear();
  sync.mutate.mockClear();
  sync.forgetGroup.mockClear();
  syncModule.lastSyncedAt = null;
  syncModule.engineFlush.mockReset();
  syncModule.engineFlush.mockImplementation(() => Promise.resolve());
  query.state = { data: undefined, isFetching: false, dataUpdatedAt: 0, refetch: vi.fn() };
  query.client.invalidateQueries.mockClear();
}

// ─────────────────────────────────────────── mirror fixtures ──

/** A mirror holding exactly these server rows. */
export function mirrorOf(tables: Partial<Record<SyncTable, MirrorRow[]>>): MirrorState {
  const changes: SyncChange[] = [];
  let seq = 1;
  for (const [table, rows] of Object.entries(tables) as [SyncTable, MirrorRow[]][]) {
    for (const row of rows) {
      changes.push({ table, groupId: String(row.group_id ?? 'scope'), seq: seq++, row });
    }
  }
  return reconcile(emptyMirror(), changes).state;
}

const AT = '2026-03-01T09:00:00Z';

/** A queue holding these mutations, in order. */
export function queueOf(
  ...items: {
    id: string;
    kind: MutationEnvelope['kind'];
    scope: string;
    payload: Record<string, unknown>;
  }[]
): QueuedMutation[] {
  let queue: QueuedMutation[] = [];
  for (const item of items) {
    queue = enqueue(queue, {
      clientMutationId: item.id,
      kind: item.kind,
      groupId: item.scope,
      clientCreatedAt: AT,
      payload: item.payload,
    });
  }
  return queue;
}

export function groupRow(id: string, extra: Record<string, unknown> = {}): MirrorRow {
  return {
    id,
    group_id: id,
    name: `Group ${id}`,
    type: 'trip',
    default_currency: 'INR',
    simplify_debts: false,
    cover_emoji: null,
    created_at: '2026-01-01T00:00:00Z',
    archived_at: null,
    deleted_at: null,
    ...extra,
  };
}

export function memberRow(
  id: string,
  groupId: string,
  profileId: string | null,
  extra: Record<string, unknown> = {},
): MirrorRow {
  return {
    id,
    group_id: groupId,
    profile_id: profileId,
    ghost_name: profileId ? null : `Ghost ${id}`,
    role: 'member',
    left_at: null,
    created_at: '2026-01-01T00:00:00Z',
    profile: profileId ? { id: profileId, display_name: `Name ${id}`, avatar_url: null } : null,
    ...extra,
  };
}

/** An expense `payer` paid in full, split between `shares` as given. */
export function expenseRow(
  id: string,
  groupId: string,
  input: {
    amount: bigint;
    payer: string;
    shares: Record<string, bigint>;
    currency?: string;
    date?: string;
    createdAt?: string;
    deletedAt?: string | null;
  },
): MirrorRow {
  return {
    id,
    group_id: groupId,
    deleted_at: input.deletedAt ?? null,
    created_at: input.createdAt ?? '2026-02-01T10:00:00Z',
    currentVersion: {
      id: `${id}-v1`,
      version_no: 1,
      description: `Expense ${id}`,
      category: null,
      category_meta: null,
      expense_date: input.date ?? '2026-02-01',
      currency: input.currency ?? 'INR',
      amount: input.amount.toString(),
      split_type: 'exact',
      split_params: { kind: 'exact' },
      author_member_id: input.payer,
      notes: null,
      payment_method: null,
      receipt_share_url: null,
      location: null,
      created_at: input.createdAt ?? '2026-02-01T10:00:00Z',
      payers: [{ member_id: input.payer, amount: input.amount.toString() }],
      shares: Object.entries(input.shares).map(([member_id, amount]) => ({
        member_id,
        amount: amount.toString(),
      })),
    },
  };
}

export function settlementRow(
  id: string,
  groupId: string,
  input: {
    from: string;
    to: string;
    amount: bigint;
    status?: string;
    currency?: string;
    initiatedAt?: string;
    confirmedAt?: string | null;
  },
): MirrorRow {
  return {
    id,
    group_id: groupId,
    from_member_id: input.from,
    to_member_id: input.to,
    currency: input.currency ?? 'INR',
    amount: input.amount.toString(),
    method: 'upi',
    status: input.status ?? 'confirmed',
    note: null,
    initiated_at: input.initiatedAt ?? '2026-02-02T10:00:00Z',
    confirmed_at: input.confirmedAt ?? null,
  };
}
