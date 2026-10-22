import { describe, expect, it } from 'vitest';

import { emptyMirror, reconcile, SyncTable, type SyncChange } from '../src';

describe('reconcile with hostile keys', () => {
  it('skips ids and tables that would reach Object.prototype', () => {
    const bad: SyncChange[] = [
      { table: SyncTable.Groups, groupId: 'g', seq: 1, row: { id: '__proto__', polluted: true } },
      { table: SyncTable.Groups, groupId: 'g', seq: 2, row: { id: 'constructor' } },
      { table: SyncTable.Groups, groupId: 'g', seq: 3, row: { id: 'prototype' }, deleted: true },
      { table: '__proto__' as SyncTable, groupId: 'g', seq: 4, row: { id: 'x' } },
      { table: 'toString' as SyncTable, groupId: 'g', seq: 5, row: { id: 'x' } },
    ];
    const { state, applied } = reconcile(emptyMirror(), bad);
    expect(applied).toEqual([]);
    expect(state.tables[SyncTable.Groups]).toEqual({});
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('x');
  });

  it('still applies a normal change', () => {
    const ok: SyncChange = { table: SyncTable.Groups, groupId: 'g', seq: 1, row: { id: 'g1' } };
    expect(reconcile(emptyMirror(), [ok]).applied).toEqual([ok]);
  });
});
