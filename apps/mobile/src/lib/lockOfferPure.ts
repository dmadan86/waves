/** Offer the app lock once per account when a couple or family group is made. */

import { isPrivateSpaceType } from '@waves/core';

export const lockOfferKey = (userId: string): string => `waves.lock_offer_shown:${userId}`;

export function shouldOfferLock(input: {
  groupType: string;
  lockEnabled: boolean;
  lockSupported: boolean;
  alreadyShown: boolean;
}): boolean {
  return (
    isPrivateSpaceType(input.groupType) &&
    input.lockSupported &&
    !input.lockEnabled &&
    !input.alreadyShown
  );
}
