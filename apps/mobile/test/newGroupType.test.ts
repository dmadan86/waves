import { describe, expect, it } from 'vitest';

import { GroupType } from '@/data/types';
import { NEW_GROUP_TILES, tileForType } from '@/lib/newGroupType';

describe('tileForType', () => {
  it('lights the tile of a type that has one', () => {
    for (const type of NEW_GROUP_TILES) expect(tileForType(type)).toBe(type);
  });

  it('folds Friends into Others', () => {
    expect(tileForType(GroupType.Friends)).toBe(GroupType.Other);
  });

  it('offers six tiles, Trip first, Company before Others', () => {
    expect(NEW_GROUP_TILES).toHaveLength(6);
    expect(NEW_GROUP_TILES[4]).toBe(GroupType.Company);
    expect(NEW_GROUP_TILES[0]).toBe(GroupType.Trip);
  });
});
