import type Ionicons from '@expo/vector-icons/Ionicons';

import { GroupType } from '@/data/types';

/** The glyph for the round badge, by group type (same set the new-group screen uses). */
export const TYPE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  [GroupType.Trip]: 'airplane',
  [GroupType.Home]: 'home',
  [GroupType.Couple]: 'heart',
  [GroupType.Event]: 'people',
  [GroupType.Friends]: 'people',
};

/**
 * The type "the {type}" reads naturally after: only these four get their own
 * word; couple, other and anything unknown fall back to the plain "group".
 */
export type InviteTypeWord = GroupType.Trip | GroupType.Home | GroupType.Event | GroupType.Friends;

export function inviteTypeWordKey(type: string | null | undefined): InviteTypeWord | 'other' {
  return type === GroupType.Trip ||
    type === GroupType.Home ||
    type === GroupType.Event ||
    type === GroupType.Friends
    ? type
    : 'other';
}

/** The art key for a group type; every GroupType has its own file, anything else gets `other`. */
export function inviteBackgroundKey(type: string | null | undefined): GroupType {
  return (Object.values(GroupType) as string[]).includes(type ?? '')
    ? (type as GroupType)
    : GroupType.Other;
}
