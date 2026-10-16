/**
 * The `premium_viewed` event: a plans screen being opened.
 */

import { useEffect, useRef } from 'react';

import { track } from '@/lib/events';

/** Counts a plans screen being opened, once per mount. */
export function useTrackPremiumViewed(screen: 'paywall' | 'upgrade'): void {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    track('premium_viewed', { screen });
  }, [screen]);
}
