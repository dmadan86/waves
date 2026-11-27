import { describe, expect, it } from 'vitest';

import { E2eeSpace } from '../src/e2ee/space';
import { e2ee } from '@waves/core';

class PendingStore {
  records: import('../src/sync/store').E2eeRecordRow[] = [];
  pending = new Map<string, import('../src/e2ee/space').PendingOp[]>();
  async readE2eeRecords() {
    return this.records;
  }
  async writeE2eeRecords(rows: readonly import('../src/sync/store').E2eeRecordRow[]) {
    for (const row of rows)
      this.records = [
        ...this.records.filter((r) => r.groupId !== row.groupId || r.id !== row.id),
        row,
      ];
  }
  async readE2eePending() {
    return [...this.pending.entries()];
  }
  async writeE2eePending(groupId: string, rows: readonly import('../src/e2ee/space').PendingOp[]) {
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
});
