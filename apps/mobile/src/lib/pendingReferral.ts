/**
 * The referral code somebody opened before they had an account, kept in the
 * keystore beside the pending group invite. See `makePendingReferralStore`.
 */
import { makePendingReferralStore } from './referral';
import { secureAuthStorage } from './secureStorage';

export const pendingReferral = makePendingReferralStore(secureAuthStorage);
