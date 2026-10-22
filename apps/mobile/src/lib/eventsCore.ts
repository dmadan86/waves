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
  // Waves Assistant (the voice agent and its follow-up questions). Which step
  // happened, never what was said: see `assistantTelemetry` for the props.
  'assistant_opened',
  'assistant_command',
  'assistant_followup_shown',
  'assistant_followup_answered',
  'assistant_followup_skipped',
  'assistant_followup_muted',
  'assistant_correction',
  'assistant_undo',
  'assistant_question_answered',
  'assistant_teaser_viewed',
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

/** The keys a prop may use, and no others. */
export const PROP_KEYS = [
  'method',
  'source',
  'medium',
  'campaign',
  'screen',
  'variant',
  // The assistant's enum words: the follow-up kind, how a step ended, which
  // path handled it, personal or group, how a mute happened, the field a
  // correction changed, and what an undo undid.
  'kind',
  'outcome',
  'path',
  'scope',
  'how',
  'field',
  'what',
] as const;

export type EventProps = Partial<Record<(typeof PROP_KEYS)[number], string>>;

export type EventPlatform = 'ios' | 'android' | 'web';

/** A short lowercase word: `phone`, `paywall`, `settings`, `google`. */
const SAFE_VALUE = /^[a-z0-9_-]{1,32}$/;

/** Campaign tags (`source`, `medium`, `campaign`) may run to 40 characters. */
const TAG_VALUE = /^[a-z0-9_-]{1,40}$/;
const TAG_KEYS: readonly string[] = ['source', 'medium', 'campaign'];

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
    const rule = TAG_KEYS.includes(key) ? TAG_VALUE : SAFE_VALUE;
    if (typeof value === 'string' && rule.test(value)) clean[key] = value;
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
