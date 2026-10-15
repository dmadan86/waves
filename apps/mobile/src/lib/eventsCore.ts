/**
 * The pure half of first-party analytics: which events exist, and what is
 * allowed to travel with one.
 *
 * Split from `lib/events` (which owns storage and the network) so the part
 * that matters for privacy is testable in plain Node. The server enforces the
 * same lists again in `waves_track_event`; this side exists so a mistake never
 * leaves the phone in the first place.
 *
 * The rule for props: short lowercase words under a known key, nothing else.
 * No amounts, descriptions, names, phone numbers, emails or SMS text — an
 * event says *which step*, never *what the person typed*.
 */

/** Only what the database cannot work out from its own rows. */
export const EVENT_NAMES = [
  'app_installed',
  'signup_started',
  'onboarding_completed',
  'premium_viewed',
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

/** The keys a prop may use, and no others. */
export const PROP_KEYS = ['method', 'source', 'screen', 'variant'] as const;

export type EventProps = Partial<Record<(typeof PROP_KEYS)[number], string>>;

export type EventPlatform = 'ios' | 'android' | 'web';

/** A short lowercase word: `phone`, `paywall`, `settings`, `google`. */
const SAFE_VALUE = /^[a-z0-9_-]{1,32}$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isEventName(value: unknown): value is EventName {
  return typeof value === 'string' && (EVENT_NAMES as readonly string[]).includes(value);
}

export function isInstallId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * Keeps known keys with safe values and drops everything else. Never throws
 * and never returns anything but a flat object of short strings.
 */
export function sanitizeProps(props: unknown): EventProps {
  if (typeof props !== 'object' || props === null || Array.isArray(props)) return {};
  const source = props as Record<string, unknown>;
  const clean: EventProps = {};
  for (const key of PROP_KEYS) {
    const value = source[key];
    if (typeof value === 'string' && SAFE_VALUE.test(value)) clean[key] = value;
  }
  return clean;
}

export function normalizePlatform(os: string): EventPlatform | null {
  return os === 'ios' || os === 'android' || os === 'web' ? os : null;
}

/** Version strings the server will keep; anything odd is sent as nothing. */
export function normalizeVersion(version: unknown): string | null {
  return typeof version === 'string' && /^[0-9A-Za-z.+_-]{1,32}$/.test(version) ? version : null;
}

export interface EventPayload {
  p_install_id: string;
  p_name: EventName;
  p_platform: EventPlatform | null;
  p_app_version: string | null;
  p_props: EventProps;
}

/** The RPC arguments for one event, or null when it should not be sent at all. */
export function buildPayload(input: {
  installId: unknown;
  name: unknown;
  props?: unknown;
  platform: string;
  version: unknown;
}): EventPayload | null {
  if (!isInstallId(input.installId) || !isEventName(input.name)) return null;
  return {
    p_install_id: input.installId,
    p_name: input.name,
    p_platform: normalizePlatform(input.platform),
    p_app_version: normalizeVersion(input.version),
    p_props: sanitizeProps(input.props),
  };
}
