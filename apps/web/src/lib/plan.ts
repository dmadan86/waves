'use client';

/** Which plan the signed-in account holds, from the server (`waves_my_plan`), as the phone reads it. Display and gating of the UI only: the functions enforce it. */

import { useEffect, useState } from 'react';

import { isPaidTier, PlanTier, planTierFromString } from '@waves/core';

import { supabase } from '@/lib/waves';

export function usePlan(): { tier: PlanTier; isPaid: boolean; loading: boolean } {
  const [tier, setTier] = useState<PlanTier | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.resolve(supabase.rpc('waves_my_plan'))
      .then(({ data, error }) => {
        if (active)
          setTier(
            error ? PlanTier.Free : planTierFromString((data as { plan?: unknown } | null)?.plan),
          );
      })
      .catch(() => active && setTier(PlanTier.Free));
    return () => {
      active = false;
    };
  }, []);
  return {
    tier: tier ?? PlanTier.Free,
    isPaid: tier !== null && isPaidTier(tier),
    loading: tier === null,
  };
}
