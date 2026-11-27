/**
 * Rentals inside a couple/home group: the mirror overlays queued
 * `group_record.*` mutations on the pulled `group_records` rows, per group.
 */

import { describe, expect, it } from 'vitest';

import {
  emptyMirror,
  enqueue,
  materialiseGroupRecords,
  MutationKind,
  reconcile,
  SyncTable,
  type QueuedMutation,
} from '../src/sync/index.js';

const GROUP = 'group-1';
const AT = '2026-12-31T10:00:00Z';
const LATER = '2026-12-31T10:05:00Z';

function queued(...items: Parameters<typeof enqueue>[1][]): QueuedMutation[] {
  let queue: QueuedMutation[] = [];
  for (const item of items) queue = enqueue(queue, item);
  return queue;
}

const serverRow = (id: string, extra: Record<string, unknown> = {}) => ({
  table: SyncTable.GroupRecords,
  groupId: GROUP,
  seq: 1,
  row: {
    id,
    group_id: GROUP,
    record_kind: 'property',
    data: { name: id },
    created_at: AT,
    deleted_at: null,
    ...extra,
  },
});

describe('protocol names', () => {
  it('uses the wire strings the sync function dispatches on', () => {
    expect(MutationKind.GroupRecordUpsert).toBe('group_record.upsert');
    expect(MutationKind.GroupRecordDelete).toBe('group_record.delete');
    expect(SyncTable.GroupRecords).toBe('group_records');
  });
});

describe('materialiseGroupRecords', () => {
  const mirror = reconcile(emptyMirror(), [
    serverRow('p1'),
    serverRow('gone', { deleted_at: AT }),
    serverRow('elsewhere', { group_id: 'group-2' }),
  ]).state;

  it('returns the live rows of that group only', () => {
    expect(materialiseGroupRecords(mirror, [], { groupId: GROUP }).map((r) => r.id)).toEqual([
      'p1',
    ]);
  });

  it('shows a queued upsert at once, an edit as pending, and an upsert after a delete un-deletes', () => {
    const queue = queued(
      {
        clientMutationId: 'a',
        kind: MutationKind.GroupRecordUpsert,
        groupId: GROUP,
        clientCreatedAt: LATER,
        payload: { recordId: 'new', recordKind: 'txn', data: { amount: '5' } },
      },
      {
        clientMutationId: 'b',
        kind: MutationKind.GroupRecordUpsert,
        groupId: GROUP,
        clientCreatedAt: LATER,
        payload: { recordId: 'gone', recordKind: 'property', data: { name: 'back' } },
      },
    );
    const rows = materialiseGroupRecords(mirror, queue, { groupId: GROUP });
    expect(rows.map((r) => r.id).sort()).toEqual(['gone', 'new', 'p1']);
    expect(rows.find((r) => r.id === 'new')).toMatchObject({ record_kind: 'txn', pending: true });
    expect(rows.find((r) => r.id === 'gone')?.deleted_at).toBeNull();
  });

  it("hides a record deleted in the queue, and ignores another group's mutations", () => {
    const queue = queued(
      {
        clientMutationId: 'd',
        kind: MutationKind.GroupRecordDelete,
        groupId: GROUP,
        clientCreatedAt: LATER,
        payload: { recordId: 'p1' },
      },
      {
        clientMutationId: 'o',
        kind: MutationKind.GroupRecordUpsert,
        groupId: 'group-2',
        clientCreatedAt: LATER,
        payload: { recordId: 'x', recordKind: 'txn', data: {} },
      },
    );
    expect(materialiseGroupRecords(mirror, queue, { groupId: GROUP })).toEqual([]);
  });
});
