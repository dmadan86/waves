/**
 * Reading local-first: the group list, one group, and its offline ledger.
 *
 * These hooks are what "UI reads local-first, always" (ADR-005) means in code —
 * the screen renders from the mirror plus the queue. What matters is what they
 * leave out (archived and deleted groups, members who left), that queued work
 * shows up before it syncs, and that the offline ledger reaches the same
 * numbers as the online one because it calls the same @waves/core functions.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { emptyMirror, SyncTable, type MirrorState } from '@waves/core';

import { useLocalGroup, useLocalGroups, useOfflineLedger } from '@/sync/hooks';

import { renderHook } from './mocks/fakeReact';

vi.mock('react', () => import('./mocks/fakeReact'));

const h = vi.hoisted(() => ({ sync: { mirror: null as unknown, queue: [] as unknown[] } }));
vi.mock('@/sync/provider', () => ({ useSync: () => h.sync }));

function mirrorWith(rows: Partial<Record<SyncTable, Record<string, unknown>[]>>): MirrorState {
  const mirror = emptyMirror() as { tables: Record<string, Record<string, unknown>> };
  for (const [table, list] of Object.entries(rows)) {
    for (const row of list ?? []) mirror.tables[table]![String(row.id)] = row;
  }
  return mirror as unknown as MirrorState;
}

function expense(id: string, groupId: string, paidBy: string, shares: Record<string, string>) {
  const total = Object.values(shares)
    .reduce((sum, value) => sum + BigInt(value), 0n)
    .toString();
  return {
    id,
    group_id: groupId,
    deleted_at: null,
    created_at: '2026-09-01T10:00:00Z',
    currentVersion: {
      id: `${id}-v1`,
      version_no: 1,
      description: 'Dinner',
      category: null,
      category_meta: null,
      expense_date: '2026-09-01',
      currency: 'INR',
      amount: total,
      split_type: 'exact',
      split_params: { kind: 'exact' },
      author_member_id: null,
      notes: null,
      payment_method: null,
      receipt_share_url: null,
      location: null,
      created_at: '2026-09-01T10:00:00Z',
      payers: [{ member_id: paidBy, amount: total }],
      shares: Object.entries(shares).map(([member_id, amount]) => ({ member_id, amount })),
    },
  };
}

beforeEach(() => {
  h.sync = { mirror: emptyMirror(), queue: [] };
});

describe('useLocalGroups', () => {
  it('lists live groups newest first, leaving out archived and deleted ones', () => {
    h.sync.mirror = mirrorWith({
      [SyncTable.Groups]: [
        { id: 'old', group_id: 'old', created_at: '2026-01-01T00:00:00Z' },
        { id: 'new', group_id: 'new', created_at: '2026-06-01T00:00:00Z' },
        {
          id: 'arch',
          group_id: 'arch',
          created_at: '2026-07-01T00:00:00Z',
          archived_at: '2026-08-01',
        },
        {
          id: 'gone',
          group_id: 'gone',
          created_at: '2026-07-01T00:00:00Z',
          deleted_at: '2026-08-01',
        },
      ],
    });
    const { result } = renderHook(() => useLocalGroups());
    expect(result.current.map((group) => group.id)).toEqual(['new', 'old']);
  });

  it('is empty on a fresh mirror', () => {
    expect(renderHook(() => useLocalGroups()).result.current).toEqual([]);
  });
});

describe('useLocalGroup', () => {
  it('returns the group, its current members and settlements, and counts its queued work', () => {
    h.sync.mirror = mirrorWith({
      [SyncTable.Groups]: [{ id: 'g1', group_id: 'g1', name: 'Trip' }],
      [SyncTable.GroupMembers]: [
        { id: 'm1', group_id: 'g1' },
        { id: 'm2', group_id: 'g1', left_at: '2026-08-01' },
        { id: 'm3', group_id: 'other' },
      ],
      [SyncTable.Settlements]: [{ id: 's1', group_id: 'g1' }],
    });
    h.sync.queue = [
      { groupId: 'g1', kind: 'noop', seq: 1, payload: {} },
      { groupId: 'g1', kind: 'noop', seq: 2, payload: {} },
      { groupId: 'other', kind: 'noop', seq: 3, payload: {} },
    ];
    const { result } = renderHook(() => useLocalGroup('g1'));
    expect(result.current.group).toMatchObject({ id: 'g1', name: 'Trip' });
    expect(result.current.members.map((m) => m.id)).toEqual(['m1']);
    expect(result.current.settlements.map((s) => s.id)).toEqual(['s1']);
    expect(result.current.pending).toBe(2);
  });

  it('answers null for a group the mirror has never seen', () => {
    const { result } = renderHook(() => useLocalGroup('missing'));
    expect(result.current.group).toBeNull();
    expect(result.current.members).toEqual([]);
    expect(result.current.expenses).toEqual([]);
  });
});

describe('useOfflineLedger', () => {
  it('computes balances, transfers and my balance from local data alone', () => {
    h.sync.mirror = mirrorWith({
      [SyncTable.Groups]: [{ id: 'g1', group_id: 'g1', default_currency: 'INR' }],
      [SyncTable.GroupMembers]: [
        { id: 'me', group_id: 'g1', profile_id: 'profile-me' },
        { id: 'you', group_id: 'g1', profile_id: 'profile-you' },
      ],
      [SyncTable.Expenses]: [expense('e1', 'g1', 'me', { me: '5000', you: '5000' })],
    });
    const { result } = renderHook(() => useOfflineLedger('g1', 'profile-me'));
    const ledger = result.current;

    expect(ledger.myMemberId).toBe('me');
    expect(ledger.myBalance).toBe(5000n);
    expect(ledger.balances.get('you')).toBe(-5000n);
    expect(ledger.transfers).toHaveLength(1);
    expect(ledger.transfers[0]).toMatchObject({ from: 'you', to: 'me' });
    expect(ledger.expenses).toHaveLength(1);
    expect(ledger.members).toHaveLength(2);
    expect(ledger.pending).toBe(0);
  });

  it('folds settlements (and their allocations) into the balances', () => {
    h.sync.mirror = mirrorWith({
      [SyncTable.Groups]: [{ id: 'g1', group_id: 'g1', default_currency: 'INR' }],
      [SyncTable.GroupMembers]: [
        { id: 'me', group_id: 'g1', profile_id: 'profile-me' },
        { id: 'you', group_id: 'g1', profile_id: 'profile-you' },
      ],
      [SyncTable.Expenses]: [expense('e1', 'g1', 'me', { me: '5000', you: '5000' })],
      [SyncTable.Settlements]: [
        {
          id: 's1',
          group_id: 'g1',
          from_member_id: 'you',
          to_member_id: 'me',
          currency: 'INR',
          amount: '5000',
          status: 'confirmed',
          initiated_at: '2026-09-02T00:00:00Z',
          allocations: [{ expense_id: 'e1', amount: '5000' }],
        },
      ],
    });
    const { result } = renderHook(() => useOfflineLedger('g1', 'profile-me'));
    expect(result.current.myBalance).toBe(0n);
    expect(result.current.transfers).toEqual([]);
  });

  it('falls back to INR, and to no member of mine, when the group or profile is unknown', () => {
    const { result } = renderHook(() => useOfflineLedger('missing', null));
    expect(result.current.group).toBeNull();
    expect(result.current.myMemberId).toBeNull();
    expect(result.current.myBalance).toBe(0n);
    expect(result.current.balances.size).toBe(0);
  });

  it('skips an expense with no current version rather than failing the ledger', () => {
    h.sync.mirror = mirrorWith({
      [SyncTable.Groups]: [{ id: 'g1', group_id: 'g1', default_currency: 'INR' }],
      [SyncTable.Expenses]: [{ ...expense('e1', 'g1', 'me', { me: '100' }), currentVersion: null }],
    });
    const { result } = renderHook(() => useOfflineLedger('g1', 'profile-me'));
    expect(result.current.expenses).toHaveLength(1);
    expect(result.current.balances.size).toBe(0);
  });
});
