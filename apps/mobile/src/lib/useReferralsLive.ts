/**
 * Whether the invite-and-earn surface is shown at all.
 *
 * The reward is days of Pro, so it means nothing where Pro cannot be bought:
 * the same condition the upgrade screen uses for `plansLive` (the `paywall`
 * flag on, and a build with a RevenueCat key). Where it is false, no card, no
 * row, no route content.
 */
import { useFlagEnabled } from '@/lib/flags';
import { purchasesAvailable } from '@/lib/purchases';

export function useReferralsLive(): boolean {
  return useFlagEnabled('paywall') && purchasesAvailable();
}
