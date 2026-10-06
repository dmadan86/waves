import { GroupType } from '@/data/types';

/**
 * The kinds the new-group screen offers as tiles, in order. Friends is a real
 * type (a name can read as one) but has no tile of its own: Others stands in
 * for it, with the Friends tag chip one tap away.
 */
export const NEW_GROUP_TILES: readonly GroupType[] = [
  GroupType.Trip,
  GroupType.Home,
  GroupType.Couple,
  GroupType.Event,
  GroupType.Other,
];

/** The tile that should read as lit for a group type. */
export function tileForType(type: GroupType): GroupType {
  return NEW_GROUP_TILES.includes(type) ? type : GroupType.Other;
}
