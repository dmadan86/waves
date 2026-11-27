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
      byGroup: { g1: { records: 2, tombstones: 1 }, g2: { records: 1, tombstones: 0 } },
    });
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
});
