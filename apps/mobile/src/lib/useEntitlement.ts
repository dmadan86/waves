/**
 * Whether this phone currently holds a Pro plan, read off the store's own
 * active subscriptions rather than anything Waves wrote down.
 *
 * NOT a security boundary. This is a client-side read of `expo-iap`'s
 * `getActiveSubscriptions()` — it is what a jailbroken phone or a tampered
 * purchase token says about itself, with nothing checked against Apple's or
 * Google's servers. It is fine for "show the Pro badge" and "hide the
 * upgrade row"; it must not be trusted for anything a person could profit
 * from faking (unlocking a paid feature a backend enforces, crediting an
 * account, granting a refundable benefit) until server-side receipt
 * verification lands — see docs/pricing.md, "Next step: server-side
 * verification". That work is out of scope for this PR.
 *
 * Mounts its own store connection via `useIAP()`. expo-iap's `initConnection`
 * tolerates being called while already connected, but `endConnection` on
 * this hook's unmount tears down the *shared* native billing client /
 * StoreKit listener — including for any other `useIAP()` consumer still
 * mounted elsewhere in the tree. Nothing else calls this hook today
 * (`paywall.tsx` derives the same entitlement from its own single `useIAP()`
 * call via `entitlementFromActiveSubscriptions`, precisely to avoid a second
 * connection). Mount this in a second place only once that sharing problem is
 * solved — a single provider around both consumers is the fix.
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useIAP } from 'expo-iap';

import {
  entitlementFromActiveSubscriptions,
  PRO_PRODUCT_IDS,
  type Entitlement,
} from '@/lib/pricing';

export interface UseEntitlementResult extends Entitlement {
  /** True until the store connection has answered at least once. */
  loading: boolean;
  /** Re-reads the store's active subscriptions — call after a purchase or
   *  restore completes elsewhere, or on pull-to-refresh. */
  refresh: () => Promise<void>;
}

export function useEntitlement(): UseEntitlementResult {
  const { connected, activeSubscriptions, getActiveSubscriptions } = useIAP();

  const refresh = useCallback(async () => {
    await getActiveSubscriptions(Object.values(PRO_PRODUCT_IDS));
  }, [getActiveSubscriptions]);

  useEffect(() => {
    if (connected) void refresh();
  }, [connected, refresh]);

  const entitlement = useMemo(
    () => entitlementFromActiveSubscriptions(activeSubscriptions),
    [activeSubscriptions],
  );

  return { ...entitlement, loading: !connected, refresh };
}
