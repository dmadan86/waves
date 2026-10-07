/**
 * Which plan this account holds, as RevenueCat's CustomerInfo reports it.
 *
 * Display only — "show the Pro badge", "hide the upgrade row", "this card is
 * your current plan". It is NOT what unlocks anything a person could profit
 * from faking: the server decides that from `subscriptions`, which only the
 * RevenueCat webhook writes (supabase/functions/revenuecat-webhook), via
 * `waves_profile_is_paid` / `waves_my_plan` / the voice quota.
 *
 * One SDK listener feeds every caller (lib/purchases.ts), so this can be
 * mounted anywhere without opening another store connection.
 */

import { isPaidTier, PlanTier } from '@waves/core';

import { purchasesAvailable, refreshCustomerInfo, useCustomerTier } from '@/lib/purchases';

export interface UseEntitlementResult {
  tier: PlanTier;
  /** Plus or Pro. */
  isPaid: boolean;
  /** Pro: everything, including the advanced voice agent. */
  isPro: boolean;
  /** True until CustomerInfo has been read once for this account. */
  loading: boolean;
  /** False on a build with no RevenueCat key: nothing can be bought. */
  available: boolean;
  refresh: () => Promise<void>;
}

export function useEntitlement(): UseEntitlementResult {
  const { tier, loading } = useCustomerTier();
  return {
    tier,
    isPaid: isPaidTier(tier),
    isPro: tier === PlanTier.Pro,
    loading,
    available: purchasesAvailable(),
    refresh: refreshCustomerInfo,
  };
}
