import { describe, expect, it } from 'vitest';

import { coupleStructure, losesCoupleData } from '../src/lib/backup/coupleStructure';

describe('couple backup structure', () => {
  it('counts groups, record states, and tombstones from decoded data', () => {
    const result = coupleStructure([
      {
        groupId: 'g1',
        name: 'Home',
        records: JSON.stringify([
          { id: 'a', fields: { name: ['x'.repeat(500), '1:0:A'] } },
          { id: 'b', deleted: '2:0:A', fields: {} },
        ]),
      },
      { groupId: 'g2', name: 'Other', records: JSON.stringify([{ id: 'c', fields: {} }]) },
    ]);
    expect(result).toEqual({
      groups: 2,
      records: 3,
      tombstones: 1,
      byGroup: {
        g1: { records: 2, tombstones: 1, recordIds: ['a'], tombstoneIds: ['b'] },
        g2: { records: 1, tombstones: 0, recordIds: ['c'], tombstoneIds: [] },
      },
    });
  });

  it('keeps a live and a former copy of one group apart', () => {
    const live = { groupId: 'g', name: 'H', records: JSON.stringify([{ id: 'a', fields: {} }]) };
    const former = {
      groupId: 'g',
      name: 'H',
      former: true,
      records: JSON.stringify([{ id: 'b', fields: {} }]),
    };
    const both = coupleStructure([live, former]);
    expect(Object.keys(both.byGroup).sort()).toEqual(['former:g', 'g']);
    expect(losesCoupleData(both, coupleStructure([live]))).toBe(true);
  });

  it('detects a missing group, fewer records, or lost tombstones by structure', () => {
    const existing = coupleStructure([
      {
        groupId: 'g',
        name: 'Home',
        records: JSON.stringify([{ id: 'a' }, { id: 'b', deleted: '2:0:A' }]),
      },
    ]);
    expect(losesCoupleData(existing, coupleStructure([]))).toBe(true);
    expect(
      losesCoupleData(
        existing,
        coupleStructure([{ groupId: 'g', name: 'Home', records: JSON.stringify([{ id: 'a' }]) }]),
      ),
    ).toBe(true);
    expect(
      losesCoupleData(
        existing,
        coupleStructure([
          { groupId: 'g', name: 'Home', records: JSON.stringify([{ id: 'a' }, { id: 'b' }]) },
        ]),
      ),
    ).toBe(true);
    expect(
      losesCoupleData(
        existing,
        coupleStructure([
          {
            groupId: 'g',
            name: 'Home',
            records: JSON.stringify([{ id: 'a' }, { id: 'b', deleted: '3:0:A' }]),
          },
        ]),
      ),
    ).toBe(false);
  });

  it('detects a record or tombstone id missing even when counts match', () => {
    const existing = coupleStructure([
      {
        groupId: 'g',
        name: 'Home',
        records: JSON.stringify([{ id: 'record-a' }, { id: 'deleted-b', deleted: '2:0:A' }]),
      },
    ]);
    const local = coupleStructure([
      {
        groupId: 'g',
        name: 'Home',
        records: JSON.stringify([
          { id: 'different-record' },
          { id: 'different-deleted', deleted: '3:0:A' },
        ]),
      },
    ]);
    expect(losesCoupleData(existing, local)).toBe(true);
  });
});
