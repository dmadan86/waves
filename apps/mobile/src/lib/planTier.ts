/**
 * Reading the server's plan next to the store's: pure, so it can be tested
 * without the SDK (see useEntitlement).
 */

import { PlanTier, tierRank } from '@waves/core';

/** `waves_my_plan`'s `plan` field as a tier; anything unexpected is Free. */
export function tierFromServerPlan(plan: unknown): PlanTier {
  return plan === 'pro' ? PlanTier.Pro : plan === 'plus' ? PlanTier.Plus : PlanTier.Free;
}

/** The higher of two tiers. */
export function higherTier(a: PlanTier, b: PlanTier): PlanTier {
  return tierRank(a) >= tierRank(b) ? a : b;
}
