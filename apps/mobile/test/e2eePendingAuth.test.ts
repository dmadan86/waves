import { describe, expect, it } from 'vitest';

import { E2eeSpace } from '../src/e2ee/space';
import { e2ee } from '@waves/core';

class PendingStore {
  records: import('../src/sync/store').E2eeRecordRow[] = [];
  pending = new Map<string, e2ee.PendingOp[]>();
  writeGate: Promise<void> | null = null;
  async readE2eeRecords() {
    return this.records;
  }
  async writeE2eeRecords(rows: readonly import('../src/sync/store').E2eeRecordRow[]) {
    if (this.writeGate) await this.writeGate;
    for (const row of rows)
      this.records = [
        ...this.records.filter((r) => r.groupId !== row.groupId || r.id !== row.id),
        row,
      ];
  }
  async readE2eePending() {
    return [...this.pending.entries()];
  }
  async writeE2eePending(groupId: string, rows: readonly e2ee.PendingOp[]) {
    this.pending.set(groupId, [...rows]);
  }
  async replaceE2eeGroup(
    groupId: string,
    rows: readonly import('../src/sync/store').E2eeRecordRow[],
  ) {
    this.records = [...this.records.filter((r) => r.groupId !== groupId), ...rows];
    this.pending.delete(groupId);
  }
}

describe('E2EE buffered operation authorization', () => {
  it('does not publish a load completed by a stale session', async () => {
    const store = new PendingStore();
    const old = new E2eeSpace(store, { now: () => 1_700_000_000_000, newId: () => 'id' });
    await old.applyIncoming([
      {
        groupId: 'g',
        senderMemberId: 'm',
        ops: [
          {
            op: 'put',
            id: 'r',
            kind: 'property',
            createdBy: 'm',
            create: true,
            fields: { name: ['Flat', '1:0:A'] },
          },
        ],
      },
    ]);
    const space = new E2eeSpace(store, { now: () => 1_700_000_000_000, newId: () => 'id' });
    let current = true;
    const originalRead = store.readE2eePending.bind(store);
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    store.readE2eePending = async () => {
      await gate;
      return originalRead();
    };
    const loading = space.load(() => current);
    current = false;
    finish();
    await loading;
    expect(space.groupIds()).toEqual([]);
  });

  it('rechecks the session after a records write before persisting pending ops', async () => {
    const store = new PendingStore();
    const space = new E2eeSpace(store, { now: () => 1_700_000_000_000, newId: () => 'id' });
    let current = true;
    let release!: () => void;
    let started!: () => void;
    store.writeGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const begun = new Promise<void>((resolve) => {
      started = resolve;
    });
    const write = store.writeE2eeRecords.bind(store);
    store.writeE2eeRecords = async (rows) => {
      started();
      await write(rows);
    };
    const incoming = space.applyIncoming(
      [
        {
          groupId: 'g',
          senderMemberId: 'm',
          ops: [
            {
              op: 'put',
              id: 'r',
              kind: 'property',
              createdBy: 'm',
              fields: { name: ['pending', '1:0:A'] },
            },
          ],
        },
      ],
      () => current,
    );
    await begun;
    current = false;
    release();
    expect(await incoming).toBe(false);
    expect(store.pending.size).toBe(0);
    expect(space.groupIds()).toEqual([]);
  });

  it('replays a buffered edit using its original sender permissions', async () => {
    const store = new PendingStore();
    const space = new E2eeSpace(store, { now: () => 1_700_000_000_000, newId: () => 'id' });
    const op = (
      fields: Record<string, e2ee.Field>,
      createdBy: string,
      create?: true,
    ): e2ee.PutOp => ({
      op: 'put',
      id: 'record',
      kind: 'property',
      createdBy,
      fields,
      ...(create ? { create } : {}),
    });
    await space.applyIncoming([
      { groupId: 'g', senderMemberId: 'mA', ops: [op({ address: ['forged', '2:0:A'] }, 'mC')] },
    ]);
    await space.applyIncoming([
      { groupId: 'g', senderMemberId: 'mB', ops: [op({ name: ['Flat', '1:0:B'] }, 'mB', true)] },
    ]);
    expect(space.records('g')[0]?.data).toEqual({ name: 'Flat' });
  });

  it('rejects an incoming reserved internal id', async () => {
    const result = e2ee.validateOp({ op: 'del', id: '__meta:pending', hlc: '1:0:A' });
    expect(result).toMatchObject({ ok: false });
  });

  it('persists pending operations across a space reload', async () => {
    const store = new PendingStore();
    const space = new E2eeSpace(store, { now: () => 1_700_000_000_000, newId: () => 'id' });
    const edit: e2ee.PutOp = {
      op: 'put',
      id: 'r',
      kind: 'property',
      createdBy: 'mC',
      fields: { address: ['A', '2:0:A'] },
    };
    await space.applyIncoming([{ groupId: 'g', senderMemberId: 'mA', ops: [edit] }]);
    const reloaded = new E2eeSpace(store, { now: () => 1_700_000_000_000, newId: () => 'id' });
    await reloaded.load();
    const create: e2ee.PutOp = {
      op: 'put',
      id: 'r',
      kind: 'property',
      createdBy: 'mB',
      create: true,
      fields: { name: ['Flat', '1:0:B'] },
    };
    await reloaded.applyIncoming([{ groupId: 'g', senderMemberId: 'mB', ops: [create] }]);
    expect(reloaded.records('g')[0]?.data).toEqual({ name: 'Flat' });
  });

  it('does not pile up copies of the same buffered edit when mail is redelivered', async () => {
    const store = new PendingStore();
    let t = 1_700_000_000_000;
    const space = new E2eeSpace(store, { now: () => (t += 1000), newId: () => 'id' });
    const edit: e2ee.PutOp = {
      op: 'put',
      id: 'r',
      kind: 'property',
      createdBy: 'mC',
      fields: { address: ['A', '2:0:A'] },
    };
    for (let i = 0; i < 3; i++)
      await space.applyIncoming([{ groupId: 'g', senderMemberId: 'mA', ops: [edit] }]);
    expect(store.pending.get('g')).toHaveLength(1);
  });
});
