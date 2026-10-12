import { GroupType } from '@/data/types';

import { inviteBackgroundKey } from './inviteCardModel';

/**
 * Full-bleed artwork behind the shared invite image, one per group type.
 *
 * PLACEHOLDERS: the files in assets/images/invite-card are 2:3 crops of
 * existing scenes so the layout can be built and checked. Replace each with the
 * real per-type illustration under the SAME filename (portrait 2:3, ~1080 px
 * wide, under ~150 KB, calm in the lower half where the card sits); nothing
 * else needs to change.
 */
export const INVITE_CARD_BACKGROUNDS: Record<GroupType, number> = {
  [GroupType.Trip]: require('../../../assets/images/invite-card/trip.webp') as number,
  [GroupType.Home]: require('../../../assets/images/invite-card/home.webp') as number,
  [GroupType.Event]: require('../../../assets/images/invite-card/event.webp') as number,
  [GroupType.Friends]: require('../../../assets/images/invite-card/friends.webp') as number,
  [GroupType.Couple]: require('../../../assets/images/invite-card/couple.webp') as number,
  [GroupType.Other]: require('../../../assets/images/invite-card/other.webp') as number,
};

export function inviteCardBackground(type: string | null | undefined): number {
  return INVITE_CARD_BACKGROUNDS[inviteBackgroundKey(type)];
}
