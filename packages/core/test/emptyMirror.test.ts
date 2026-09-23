import { describe, expect, it } from 'vitest';

import { emptyMirror, materialisePackInstalls, SyncTable } from '../src';

describe('emptyMirror', () => {
  it('has a table for every table the sync protocol names', () => {
    // A table missing here is a crash, not an empty list: every reader walks
    // `state.tables[table]`, which is undefined for a table nobody allocated.
    const tables = emptyMirror().tables as Record<string, unknown>;
    for (const table of Object.values(SyncTable)) {
      expect(tables[table], table).toEqual({});
    }
  });

  it('reads no pack installs, rather than throwing, before any have synced', () => {
    expect(() => materialisePackInstalls(emptyMirror(), [], { ownerId: 'p-me' })).not.toThrow();
  });
});
