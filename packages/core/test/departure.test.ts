/**
 * Signing out erases this device's copy, so what the sheet says is about to be
 * lost has to be right: an undercount is data thrown away by someone who was
 * told there was nothing to keep.
 */

import { describe, expect, it } from 'vitest';

import {
  deviceSnapshot,
  emptyMirror,
  applyOutcomes,
  enqueue,
  MutationKind,
  personalScope,
  reconcile,
  snapshotFilename,
  SyncRejectionCode,
  SyncTable,
  unsentWork,
  type MutationEnvelope,
  type QueuedMutation,
} from '../src/sync/index.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const GROUP = '22222222-2222-4222-8222-222222222222';

function envelope(kind: MutationKind, groupId: string, id: string): MutationEnvelope {
  return {
    clientMutationId: id,
    kind,
    groupId,
    clientCreatedAt: '2026-09-08T10:00:00.000Z',
    payload: {},
  };
}

function queueOf(...envelopes: MutationEnvelope[]): QueuedMutation[] {
  return envelopes.reduce<QueuedMutation[]>((queue, item) => enqueue(queue, item), []);
}

describe('unsentWork', () => {
  it('is empty for an empty queue', () => {
    expect(unsentWork([], OWNER)).toEqual({ personal: 0, other: 0, refused: 0, total: 0 });
  });

  it('separates the personal ledger from everything else', () => {
    const queue = queueOf(
      envelope(MutationKind.PersonalUpsert, personalScope(OWNER), 'p1'),
      envelope(MutationKind.PersonalDelete, personalScope(OWNER), 'p2'),
      envelope(MutationKind.ExpenseCreate, GROUP, 'e1'),
      envelope(MutationKind.CaptureCreate, OWNER, 'c1'),
    );

    expect(unsentWork(queue, OWNER)).toEqual({
      personal: 2,
      other: 2,
      refused: 0,
      total: 4,
    });
  });

  it('counts a refusal apart from what is still on its way', () => {
    const { queue } = applyOutcomes(
      queueOf(
        envelope(MutationKind.ExpenseCreate, GROUP, 'e1'),
        envelope(MutationKind.ExpenseCreate, GROUP, 'e2'),
      ),
      [
        {
          clientMutationId: 'e2',
          status: 'rejected',
          code: SyncRejectionCode.ValidationFailed,
          message: 'The server refused this change',
        },
      ],
    );

    // The refused one is still in the queue — it is the only copy — but it is
    // not "sending", so it must not be counted as pending.
    expect(unsentWork(queue, OWNER)).toEqual({
      personal: 0,
      other: 1,
      refused: 1,
      total: 2,
    });
  });

  it('puts everything in `other` when nobody is signed in', () => {
    const queue = queueOf(envelope(MutationKind.PersonalUpsert, personalScope(OWNER), 'p1'));
    expect(unsentWork(queue, '')).toMatchObject({ personal: 0, other: 1, total: 1 });
  });
});

describe('deviceSnapshot', () => {
  const mirror = reconcile(emptyMirror(), [
    {
      table: SyncTable.Groups,
      seq: 2,
      groupId: GROUP,
      row: { id: GROUP, name: 'Goa' },
    },
    {
      table: SyncTable.Expenses,
      seq: 3,
      groupId: GROUP,
      row: { id: 'b-expense', description: 'Second' },
    },
    {
      table: SyncTable.Expenses,
      seq: 4,
      groupId: GROUP,
      row: { id: 'a-expense', description: 'First' },
    },
  ]).state;

  it('carries the rows, the cursors and the unsent queue', () => {
    const queue = queueOf(envelope(MutationKind.ExpenseCreate, GROUP, 'e1'));
    const snapshot = deviceSnapshot({
      mirror,
      queue,
      drafts: [],
      ownerId: OWNER,
      exportedAt: '2026-09-08T10:30:00.000Z',
    });

    expect(snapshot.format).toBe('waves.device.snapshot');
    expect(snapshot.ownerId).toBe(OWNER);
    expect(snapshot.cursors[GROUP]).toBe(4);
    expect(snapshot.tables[SyncTable.Groups]).toHaveLength(1);
    expect(snapshot.counts).toEqual({ rows: 3, unsent: 1, drafts: 0 });
    // The queue is the only copy of an unsent change; it has to be in the file.
    expect(snapshot.unsent[0]?.clientMutationId).toBe('e1');
  });

  it('carries the drafts whole, ordered by key', () => {
    const snapshot = deviceSnapshot({
      mirror,
      queue: [],
      drafts: [
        { key: 'expense:zzz', value: { description: 'Chai' }, savedAt: '2026-09-08T09:00:00.000Z' },
        { key: 'expense:aaa', value: { description: 'Auto' }, savedAt: '2026-09-08T08:00:00.000Z' },
      ],
      ownerId: OWNER,
      exportedAt: '2026-09-08T10:30:00.000Z',
    });

    expect(snapshot.drafts.map((draft) => draft.key)).toEqual(['expense:aaa', 'expense:zzz']);
    expect(snapshot.counts.drafts).toBe(2);
    // A draft was never submitted, so nothing else holds it — the value goes in
    // exactly as the store handed it over, unread and unreshaped.
    expect(snapshot.drafts[0]?.value).toEqual({ description: 'Auto' });
    expect(snapshot.drafts[0]?.savedAt).toBe('2026-09-08T08:00:00.000Z');
  });

  it('is deterministic — same state, same bytes', () => {
    const input = {
      mirror,
      queue: queueOf(envelope(MutationKind.ExpenseCreate, GROUP, 'e1')),
      drafts: [
        { key: 'expense:zzz', value: { description: 'Chai' }, savedAt: '2026-09-08T09:00:00.000Z' },
        { key: 'expense:aaa', value: { description: 'Auto' }, savedAt: '2026-09-08T08:00:00.000Z' },
      ],
      ownerId: OWNER,
      exportedAt: '2026-09-08T10:30:00.000Z',
    };
    expect(JSON.stringify(deviceSnapshot(input))).toBe(JSON.stringify(deviceSnapshot(input)));
    // Rows are ordered by id, not by the order they arrived in.
    expect(deviceSnapshot(input).tables[SyncTable.Expenses]?.map((row) => row.id)).toEqual([
      'a-expense',
      'b-expense',
    ]);
  });

  it('names the file with a stamp no filesystem objects to', () => {
    const name = snapshotFilename('2026-09-08T10:30:00.000Z');
    expect(name).toBe('waves-device-copy-2026-09-08T10-30-00-000.json');
    expect(name).not.toContain(':');
  });
});
