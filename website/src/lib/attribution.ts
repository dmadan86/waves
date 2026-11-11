/**
 * First-party campaign attribution. Only the five standard utm_* tags are kept,
 * each capped in length, in sessionStorage (cleared when the tab closes).
 * Nothing leaves the browser except on a link the visitor clicks.
 */
export const ATTRIBUTION_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const;

export const MAX_VALUE_LENGTH = 100;
const STORAGE_KEY = 'waves.attribution';

export type Attribution = Partial<Record<(typeof ATTRIBUTION_KEYS)[number], string>>;

/** Allowlisted, trimmed, length-capped utm_* params from a query string. */
export function parseAttribution(search: string): Attribution {
  const params = new URLSearchParams(search);
  const out: Attribution = {};
  for (const key of ATTRIBUTION_KEYS) {
    const value = (params.get(key) ?? '')
      .replace(/\p{Cc}/gu, '') // control characters
      .trim()
      .slice(0, MAX_VALUE_LENGTH);
    if (value) out[key] = value;
  }
  return out;
}

/** Remember tags from the current URL; a visit with none keeps the earlier ones. */
export function captureAttribution(search: string): Attribution {
  const fresh = parseAttribution(search);
  try {
    if (Object.keys(fresh).length) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
      return fresh;
    }
    // Re-parse through the allowlist so tampered storage cannot widen it.
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}') as Record<
      string,
      string
    >;
    return parseAttribution(new URLSearchParams(stored).toString());
  } catch {
    return fresh; // storage blocked or corrupt: attribution is best-effort
  }
}

/**
 * Add the tags to an absolute http(s) destination. Existing query params win and
 * are preserved. Play Store links get them as one URL-encoded `referrer`; other
 * store links are left alone (no approved passthrough for the App Store here).
 */
export function withAttribution(href: string, attr: Attribution, kind: 'web' | 'store'): string {
  if (!Object.keys(attr).length) return href;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return href;

  if (kind === 'store') {
    if (url.hostname !== 'play.google.com' || url.searchParams.has('referrer')) return href;
    url.searchParams.set(
      'referrer',
      new URLSearchParams(attr as Record<string, string>).toString(),
    );
  } else {
    for (const [k, v] of Object.entries(attr)) {
      if (!url.searchParams.has(k)) url.searchParams.set(k, v);
    }
  }
  return url.toString();
}
