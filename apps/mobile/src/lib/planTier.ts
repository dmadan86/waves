/**
 * Reading the server's plan next to the store's: pure, so it can be tested
 * without the SDK (see useEntitlement).
 */

import { planTierFromString, tierRank, type PlanTier } from '@waves/core';

/** `waves_my_plan`'s `plan` field as a tier; the retired 'plus' is Pro, anything unexpected is Free. */
export function tierFromServerPlan(plan: unknown): PlanTier {
  return planTierFromString(plan);
}

/** The higher of two tiers. */
export function higherTier(a: PlanTier, b: PlanTier): PlanTier {
  return tierRank(a) >= tierRank(b) ? a : b;
}
