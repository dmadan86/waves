import { GroupType } from '@/data/types';

import { inviteBackgroundKey } from './inviteCardModel';

/**
 * Full-bleed artwork behind the shared invite image, one per group type.
 *
 * Cut from the per-type artwork set (trip, home, event, friends, couple,
 * other) at 720 px wide. A higher-resolution export of the same scenes can
 * replace each file under the same name; nothing else needs to change.
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
