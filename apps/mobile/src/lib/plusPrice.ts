/**
 * The Plus price test on the phone: which arm this person is in, and the
 * `premium_viewed` event that carries it so conversion can be compared per arm.
 * The pure parts (arms, offering ids, picking an offering) are in `pricing`.
 */

import { useEffect, useRef } from 'react';

import { track } from '@/lib/events';
import { useFlagVerdict } from '@/lib/flags';
import { isPlusPriceVariant, PLUS_PRICE_FLAG } from '@/lib/pricing';

/** The person's arm (null outside the test), and whether the flag table has been read. */
export function usePlusPriceVariant(): { variant: string | null; settled: boolean } {
  const { variant, settled } = useFlagVerdict(PLUS_PRICE_FLAG);
  return { variant: isPlusPriceVariant(variant) ? variant : null, settled };
}

/**
 * Counts a plans screen being opened, once per mount, tagged with the arm.
 * Waits for the flag to settle so the arm is not missing from the event just
 * because the flag table was still loading.
 */
export function useTrackPremiumViewed(screen: 'paywall' | 'upgrade'): void {
  const { variant, settled } = usePlusPriceVariant();
  const sent = useRef(false);
  useEffect(() => {
    if (!settled || sent.current) return;
    sent.current = true;
    track('premium_viewed', variant ? { screen, variant } : { screen });
  }, [settled, variant, screen]);
}
