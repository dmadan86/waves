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
 *
 * The server's plan (`waves_my_plan`) is read alongside, and the higher of the
 * two wins. A plan granted outside the stores (a promo row in `subscriptions`)
 * never reaches CustomerInfo, and a build with no RevenueCat key has no
 * CustomerInfo at all; without this, both said "Free" to somebody the server
 * already treats as Pro.
 */

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';

import { isPaidTier, PlanTier } from '@waves/core';

import { useViewerId } from '@/lib/auth';
import { backend } from '@/lib/backend';
import { higherTier, tierFromServerPlan } from '@/lib/planTier';
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
  const { tier: storeTier, loading } = useCustomerTier();
  const viewerId = useViewerId();
  const server = useQuery({
    queryKey: ['myPlan', viewerId],
    enabled: viewerId !== null,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PlanTier> => {
      const { data, error } = await backend.rpc('waves_my_plan');
      if (error) throw error;
      return tierFromServerPlan((data as { plan?: unknown } | null)?.plan);
    },
  });
  const tier = higherTier(storeTier, server.data ?? PlanTier.Free);
  const { refetch } = server;
  const refresh = useCallback(async () => {
    await Promise.all([refreshCustomerInfo(), refetch()]);
  }, [refetch]);
  return {
    tier,
    isPaid: isPaidTier(tier),
    isPro: tier === PlanTier.Pro,
    loading,
    available: purchasesAvailable(),
    refresh,
  };
}
