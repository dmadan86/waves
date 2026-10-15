/**
 * The pure half of the network log: what is recorded, how a URL is made safe to
 * keep, which purpose a connection is filed under, and how the list is capped.
 * No react-native import, so all of it is tested under node.
 *
 * THE PROMISE. The log is kept on the phone and never uploaded. An entry holds
 * a time, a method, `scheme://host/path` (no query string, no fragment, no
 * userinfo), a status, a duration and a purpose — never a header, a body, a
 * token or anything a server answered. Paths can carry ids, so UUIDs and digit
 * runs are replaced with `…` before anything is stored; a phone number can
 * therefore never reach the list. Keep it that way: `redactUrl` is the only door
 * a URL goes through.
 */

/** The labels a connection can be filed under; the screen translates each. */
export type NetPurpose =
  | 'sync'
  | 'sign-in'
  | 'analytics'
  | 'files'
  | 'exchange-rates'
  | 'server-task'
  | 'purchases'
  | 'crash-reports'
  | 'session-replay'
  | 'google'
  | 'maps'
  | 'other';

export const NET_PURPOSES: readonly NetPurpose[] = [
  'sync',
  'sign-in',
  'analytics',
  'files',
  'exchange-rates',
  'server-task',
  'purchases',
  'crash-reports',
  'session-replay',
  'google',
  'maps',
  'other',
];

/** How a call ended: the HTTP status, or why there was none. */
export type NetStatus = number | 'failed' | 'offline';

/** One recorded connection. Short keys: up to 1000 of these are stored. */
export interface NetLogEntry {
  /** When it started, epoch ms. */
  t: number;
  /** HTTP method, upper case. */
  m: string;
  /** `scheme://host/path`, already redacted. */
  u: string;
  s: NetStatus;
  /** Duration in ms. */
  d: number;
  p: NetPurpose;
}

export const NET_LOG_MAX_ENTRIES = 1000;
export const NET_LOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** What is shown in place of an address that could not be read. */
export const UNREADABLE_URL = '(unreadable address)';

/** Kept paths are cut here, so a stray blob in a path cannot fill the list. */
const MAX_PATH_LENGTH = 200;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// A run of digits, allowing the separators phone numbers are written with
// (space, dot, dash, brackets and their percent-encodings), judged by how many
// digits it holds rather than how long it looks.
const DIGIT_RUN = /\d(?:\d|[ ().-]|%20|%2[8-9dDeE])*\d/g;
const MIN_DIGITS = 6;

/** Mask ids in a path: UUIDs and runs of six or more digits become `…`. */
export function redactPath(path: string): string {
  const masked = path
    .replace(UUID, '…')
    .replace(DIGIT_RUN, (run) => (run.replace(/\D/g, '').length >= MIN_DIGITS ? '…' : run));
  return masked.length > MAX_PATH_LENGTH ? `${masked.slice(0, MAX_PATH_LENGTH)}…` : masked;
}

export interface UrlParts {
  scheme: string;
  host: string;
  path: string;
}

const URL_SHAPE = /^([a-z][a-z0-9+.-]*):\/\/([^/?#\\]*)([^?#]*)/i;

/**
 * Split a URL into the three parts that may be kept, or null when it is not a
 * hierarchical URL with a host. Query, fragment and userinfo are dropped here.
 */
export function urlParts(url: string): UrlParts | null {
  if (typeof url !== 'string') return null;
  const match = URL_SHAPE.exec(url.trim());
  if (!match) return null;
  const authority = match[2];
  // Userinfo is everything up to the last `@`.
  const host = authority.slice(authority.lastIndexOf('@') + 1).toLowerCase();
  if (!host || /\s/.test(host)) return null;
  const path = match[3] || '/';
  return { scheme: match[1].toLowerCase(), host, path: redactPath(path) };
}

/** `scheme://host/path`, with ids masked and nothing else kept. */
export function redactUrl(url: string): string {
  const parts = urlParts(url);
  return parts ? `${parts.scheme}://${parts.host}${parts.path}` : UNREADABLE_URL;
}

/** Host and path of a stored (already redacted) address, for display. */
export function displayAddress(redacted: string): string {
  return redacted.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
}

/** A development server, which the log leaves out of a dev build. */
export function isLocalHost(host: string): boolean {
  const bare = host.replace(/:\d+$/, '').toLowerCase();
  return (
    bare === 'localhost' ||
    bare === '127.0.0.1' ||
    bare === '[::1]' ||
    bare === '10.0.2.2' ||
    /^10\.\d+\.\d+\.\d+$/.test(bare) ||
    /^192\.168\.\d+\.\d+$/.test(bare) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(bare) ||
    bare.endsWith('.local')
  );
}

const SUPABASE_HOST = /(^|\.)supabase\.(co|in|net)$/;

function functionPurpose(name: string): NetPurpose {
  switch (name) {
    case 'fx-rate':
      return 'exchange-rates';
    case 'r2-sign':
      return 'files';
    case 'sync':
    case 'expense-write':
      return 'sync';
    case 'otp-send':
    case 'phone-verify':
    case 'auth-email-send':
      return 'sign-in';
    default:
      return 'server-task';
  }
}

/** `host` is `domain` itself or one of its subdomains — never a lookalike such as `evilsentry.io`. */
function isUnder(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * File a connection under a purpose, from where it went. `extra.mapHosts` lets
 * a build that points the map tiles at its own provider say so.
 */
export function purposeFor(
  host: string,
  path: string,
  extra: { mapHosts?: readonly string[] } = {},
): NetPurpose {
  const h = host.replace(/:\d+$/, '').toLowerCase();
  const p = path.startsWith('/') ? path : `/${path}`;

  if (isUnder(h, 'revenuecat.com')) return 'purchases';
  if (isUnder(h, 'sentry.io') || h.startsWith('ingest.') || h.includes('.ingest.')) {
    return 'crash-reports';
  }
  if (isUnder(h, 'clarity.ms')) return 'session-replay';
  if (isUnder(h, 'cloudflarestorage.com')) return 'files';
  if (
    isUnder(h, 'openstreetmap.org') ||
    h === 'maps.googleapis.com' ||
    h === 'maps.gstatic.com' ||
    (extra.mapHosts ?? []).some((m) => m.toLowerCase() === h)
  ) {
    return 'maps';
  }
  if (
    [
      'googleapis.com',
      'firebaseio.com',
      'firebaseapp.com',
      'firebase.com',
      'google.com',
      'gstatic.com',
    ].some((domain) => isUnder(h, domain))
  ) {
    return 'google';
  }

  // Supabase is told apart by its path as well as its host, so a project behind
  // a custom domain is still recognised.
  const supabase = SUPABASE_HOST.test(h);
  const fn = /^\/functions\/v1\/([^/?#]+)/.exec(p);
  if (fn) return functionPurpose(fn[1]);
  if (/^\/auth\/v1(\/|$)/.test(p)) return 'sign-in';
  if (/^\/storage\/v1(\/|$)/.test(p)) return 'files';
  if (/^\/rest\/v1\/rpc\/waves_track_event(\/|$)/.test(p)) return 'analytics';
  if (/^\/rest\/v1(\/|$)/.test(p)) return 'sync';
  if (supabase) return 'server-task';
  return 'other';
}

/**
 * Cap a list: drop entries older than the age limit, then keep only the newest
 * `maxEntries`. Oldest first in, oldest first out.
 */
export function trimLog(
  entries: readonly NetLogEntry[],
  now: number,
  maxEntries: number = NET_LOG_MAX_ENTRIES,
  maxAgeMs: number = NET_LOG_MAX_AGE_MS,
): NetLogEntry[] {
  const cutoff = now - maxAgeMs;
  const fresh = entries.filter((e) => e.t >= cutoff);
  return fresh.length > maxEntries ? fresh.slice(fresh.length - maxEntries) : fresh;
}

/** Add one entry (newest last) and cap the list. */
export function appendEntry(
  entries: readonly NetLogEntry[],
  entry: NetLogEntry,
  now: number,
  maxEntries: number = NET_LOG_MAX_ENTRIES,
  maxAgeMs: number = NET_LOG_MAX_AGE_MS,
): NetLogEntry[] {
  return trimLog([...entries, entry], now, maxEntries, maxAgeMs);
}

/** Read a stored list back, keeping only well-formed entries. */
export function parseStoredLog(raw: string | null): NetLogEntry[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(
      (e): e is NetLogEntry =>
        !!e &&
        typeof e.t === 'number' &&
        typeof e.m === 'string' &&
        typeof e.u === 'string' &&
        typeof e.d === 'number' &&
        (typeof e.s === 'number' || e.s === 'failed' || e.s === 'offline') &&
        NET_PURPOSES.includes(e.p),
    );
  } catch {
    return [];
  }
}

/** What the fetch wrapper saw of one call, before anything is redacted. */
export interface RawCall {
  method: string;
  url: string;
  startedAt: number;
  durationMs: number;
  /** The HTTP status, or null when the call threw. */
  status: number | null;
}

/**
 * Turn a raw call into an entry, or null when it should not be kept (an address
 * that cannot be read, or a local development server when `skipLocal`).
 */
export function toEntry(
  call: RawCall,
  options: { offline?: boolean; skipLocal?: boolean; mapHosts?: readonly string[] } = {},
): NetLogEntry | null {
  const parts = urlParts(call.url);
  if (!parts) return null;
  if (options.skipLocal && isLocalHost(parts.host)) return null;
  const status: NetStatus = call.status ?? (options.offline ? 'offline' : 'failed');
  return {
    t: call.startedAt,
    m: (call.method || 'GET').toUpperCase(),
    u: `${parts.scheme}://${parts.host}${parts.path}`,
    s: status,
    d: Math.max(0, Math.round(call.durationMs)),
    p: purposeFor(parts.host, parts.path, { mapHosts: options.mapHosts }),
  };
}

type FetchFn = (input: never, init?: never) => Promise<unknown>;

/** The method and address of a fetch call. Reads nothing else from it. */
export function describeFetchArgs(input: unknown, init: unknown): { method: string; url: string } {
  let url = '';
  let method = 'GET';
  try {
    if (typeof input === 'string') url = input;
    else if (input && typeof (input as { url?: unknown }).url === 'string') {
      url = (input as { url: string }).url;
      const m = (input as { method?: unknown }).method;
      if (typeof m === 'string') method = m;
    } else if (input && typeof (input as { href?: unknown }).href === 'string') {
      url = (input as { href: string }).href;
    }
    const initMethod = (init as { method?: unknown } | null | undefined)?.method;
    if (typeof initMethod === 'string') method = initMethod;
  } catch {
    // An exotic argument is simply not logged.
  }
  return { method: method.toUpperCase(), url };
}

/**
 * Wrap a fetch so each call is reported once it settles. The wrapper hands back
 * the original's promise outcome untouched — the same response object, the same
 * error — never waits on the report, and swallows anything the report throws.
 */
export function wrapFetch<F extends FetchFn>(
  original: F,
  report: (call: RawCall) => void,
  clock: () => number = Date.now,
): F {
  const wrapped = function (this: unknown, ...args: unknown[]): Promise<unknown> {
    let startedAt = 0;
    let method = 'GET';
    let url = '';
    try {
      startedAt = clock();
      ({ method, url } = describeFetchArgs(args[0], args[1]));
    } catch {
      // Logging never gets in the way of the request.
    }
    const finish = (status: number | null): void => {
      try {
        report({ method, url, startedAt, durationMs: clock() - startedAt, status });
      } catch {
        // Same.
      }
    };
    const outcome = (original as unknown as (...a: unknown[]) => Promise<unknown>).apply(
      this,
      args,
    );
    // Observe the outcome on a branch; the caller still gets the original promise.
    try {
      Promise.resolve(outcome).then(
        (res) =>
          finish(
            typeof (res as { status?: unknown })?.status === 'number'
              ? (res as { status: number }).status
              : null,
          ),
        () => finish(null),
      );
    } catch {
      // Nothing to do.
    }
    return outcome;
  };
  return wrapped as unknown as F;
}
