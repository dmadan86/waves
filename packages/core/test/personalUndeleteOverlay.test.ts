/**
 * An offline hand-off undo upserts the personal entry under its original id.
 * The server clears `deleted_at` on every upsert ("an edit after a remove
 * un-deletes the record"); the optimistic overlay must do the same, or the
 * entry stays hidden until the next sync.
 */

import { describe, expect, it } from 'vitest';

import {
  emptyMirror,
  enqueue,
  materialisePersonalRecords,
  MutationKind,
  personalScope,
  reconcile,
  SyncTable,
  type QueuedMutation,
} from '../src/sync/index.js';

const OWNER = 'owner-1';
const AT = '2026-10-19T10:00:00Z';

function queued(...items: Parameters<typeof enqueue>[1][]): QueuedMutation[] {
  let queue: QueuedMutation[] = [];
  for (const item of items) queue = enqueue(queue, item);
  return queue;
}

describe('materialisePersonalRecords: an upsert after a delete', () => {
  it('un-deletes a record the server already tombstoned (offline handoff undo)', () => {
    const mirror = reconcile(emptyMirror(), [
      {
        table: SyncTable.PersonalRecords,
        groupId: personalScope(OWNER),
        seq: 3,
        row: {
          id: 'rec-1',
          owner_user_id: OWNER,
          record_kind: 'txn',
          data: { description: 'Lunch' },
          created_at: AT,
          deleted_at: AT,
        },
      },
    ]).state;
    const queue = queued({
      clientMutationId: 'restore',
      kind: MutationKind.PersonalUpsert,
      groupId: personalScope(OWNER),
      clientCreatedAt: '2026-10-19T10:05:00Z',
      payload: { recordId: 'rec-1', recordKind: 'txn', data: { description: 'Lunch' } },
    });
    const live = materialisePersonalRecords(mirror, queue, { ownerId: OWNER });
    expect(live.map((r) => r.id)).toEqual(['rec-1']);
    expect(live[0]?.deleted_at).toBeNull();
  });

  it('un-deletes a record deleted earlier in the same queue', () => {
    const scope = personalScope(OWNER);
    const queue = queued(
      {
        clientMutationId: 'a',
        kind: MutationKind.PersonalUpsert,
        groupId: scope,
        clientCreatedAt: AT,
        payload: { recordId: 'rec-2', recordKind: 'txn', data: { n: 1 } },
      },
      {
        clientMutationId: 'b',
        kind: MutationKind.PersonalDelete,
        groupId: scope,
        clientCreatedAt: '2026-10-19T10:01:00Z',
        payload: { recordId: 'rec-2' },
      },
      {
        clientMutationId: 'c',
        kind: MutationKind.PersonalUpsert,
        groupId: scope,
        clientCreatedAt: '2026-10-19T10:02:00Z',
        payload: { recordId: 'rec-2', recordKind: 'txn', data: { n: 2 } },
      },
    );
    const live = materialisePersonalRecords(emptyMirror(), queue, { ownerId: OWNER });
    expect(live).toHaveLength(1);
    expect(live[0]?.data).toEqual({ n: 2 });
  });
});
