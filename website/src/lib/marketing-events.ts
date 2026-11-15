import { captureAttribution } from './attribution';

export type MarketingEvent = 'store_click' | 'web_app_click';

/**
 * First-party click events. A no-op unless NEXT_PUBLIC_MARKETING_EVENTS_URL is
 * set; carries only locale, path, placement and the allowlisted utm_* tags.
 */
export function trackMarketingEvent(name: MarketingEvent, placement: string): void {
  const endpoint = process.env.NEXT_PUBLIC_MARKETING_EVENTS_URL;
  if (!endpoint || typeof navigator === 'undefined' || !navigator.sendBeacon) return;
  const { pathname, search } = window.location;
  const body = JSON.stringify({
    event: name,
    locale: pathname.split('/')[1] ?? '',
    path: pathname,
    placement,
    ...captureAttribution(search),
  });
  // text/plain keeps the beacon a CORS "simple" request (no preflight).
  navigator.sendBeacon(endpoint, new Blob([body], { type: 'text/plain' }));
}
