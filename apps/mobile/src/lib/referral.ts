/**
 * Referral links and codes, with nothing native anywhere near them.
 *
 * A person shares `https://app.wavs.co.in/r/<CODE>`. The friend signs up, the
 * code is claimed (`waves_claim_referral`), and once the friend has used Waves
 * for real the server grants both of them 7 days of Plus. Everything the server
 * decides stays on the server; this module only reads and writes the strings
 * around it, so it can be tested without a device and imported from
 * `+native-intent`, which runs before the app exists.
 *
 * No React Native, no Expo: the one import is the web origin constant.
 */

import { WEB_URL } from '@/lib/webUrl';

/** Same alphabet as `referral_codes_shape`: no 0, O, 1, I or L. */
export const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const REFERRAL_CODE_LENGTH = 8;

/** The days one account can earn in total, and what one friend is worth. */
export const REFERRAL_DAYS_CAP = 30;
export const REFERRAL_DAYS_PER_FRIEND = 7;

const CODE_SHAPE = new RegExp(`^[${REFERRAL_CODE_ALPHABET}]{${REFERRAL_CODE_LENGTH}}$`);

/**
 * A code as the server will accept it, or null.
 *
 * Case, spaces and dashes are forgiven ("abcd-2345" is a common way to read a
 * code aloud); a character outside the alphabet is not, because no code the
 * server mints contains one.
 */
export function normalizeReferralCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const cleaned = input.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return CODE_SHAPE.test(cleaned) ? cleaned : null;
}

/** The personal link for a code. `base` is the web origin, injectable for tests. */
export function referralLink(code: string, base: string = WEB_URL): string {
  const normalized = normalizeReferralCode(code);
  if (!normalized) throw new Error('referralLink: not a referral code');
  return `${base.replace(/\/+$/, '')}/r/${normalized}`;
}

/** Hosts whose `/r/<CODE>` is ours: the app host, and the marketing domain. */
const REFERRAL_HOSTS = new Set([
  new URL(WEB_URL).hostname.toLowerCase(),
  'wavs.co.in',
  'www.wavs.co.in',
]);

/**
 * The code out of a link the OS handed over, or null when it is not a referral
 * link. Accepts `https://<our host>/r/<CODE>` and `waves://r/<CODE>`; a code
 * with the wrong shape is not a referral link at all.
 */
export function referralCodeFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.replace(/\/+$/, '');

  let candidate: string | null = null;
  if (scheme === 'https' && REFERRAL_HOSTS.has(host)) {
    const match = path.match(/^\/r\/([^/]+)$/);
    candidate = match?.[1] ?? null;
  } else if (scheme === 'waves') {
    // `waves://r/CODE` puts `r` in the host; `waves:///r/CODE` puts it in the path.
    if (host === 'r') candidate = path.replace(/^\//, '').split('/')[0] || null;
    else if (host === '') candidate = path.match(/^\/r\/([^/]+)$/)?.[1] ?? null;
  }
  if (candidate === null) return null;
  try {
    return normalizeReferralCode(decodeURIComponent(candidate));
  } catch {
    return null;
  }
}

/** The text handed to the native share sheet: one line, then the link. */
export function referralShareText(message: string, link: string): string {
  return `${message.trim()} ${link}`;
}

// ── the code that rode along with the install ───────────────────────────────

/** The query key the web landing page puts inside the Play Store `referrer=`. */
export const INSTALL_REFERRER_KEY = 'waves_ref';

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

/**
 * The referral code inside a Play Install Referrer string, or null.
 *
 * The string is whatever followed `referrer=` on the Play Store link, decoded
 * once by Play: `waves_ref=ABCD2345` with any `utm_*` pairs beside it. Be
 * forgiving of one more level of encoding (`waves_ref%3DABCD2345`), but never
 * of a value that is not a code: anything else is null. Hand-parsed because
 * Hermes' URLSearchParams is not something to lean on.
 */
export function referralCodeFromInstallReferrer(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;
  const attempts = text.includes('=') ? [text] : [safeDecode(text)];
  for (const attempt of attempts) {
    for (const pair of attempt.split('&')) {
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      if (safeDecode(pair.slice(0, eq)).trim() !== INSTALL_REFERRER_KEY) continue;
      const code = normalizeReferralCode(safeDecode(pair.slice(eq + 1)));
      if (code) return code;
    }
  }
  return null;
}

export interface InstallCampaign {
  source?: string;
  medium?: string;
  campaign?: string;
}

const CAMPAIGN_KEYS = {
  utm_source: 'source',
  utm_medium: 'medium',
  utm_campaign: 'campaign',
} as const;

/** A campaign tag: lowercase letters, digits, `_` and `-`, at most 40 characters. */
const CAMPAIGN_VALUE = /^[a-z0-9_-]{1,40}$/;

/** 16 or more hex digits in a row is an id (a click id, a uuid), never a campaign name. */
const LOOKS_LIKE_ID = /[0-9a-f]{16,}/;

function campaignValue(raw: string): string | null {
  const value = safeDecode(raw).trim().toLowerCase();
  if (!CAMPAIGN_VALUE.test(value)) return null;
  const compact = value.replace(/[-_]/g, '');
  return LOOKS_LIKE_ID.test(compact) ? null : value;
}

/**
 * The campaign tag inside a Play Install Referrer string: `utm_source`,
 * `utm_medium` and `utm_campaign`, each a lowercase [a-z0-9_-] word of at most
 * 40 characters. Anything else is dropped: other params (`gclid`, `fbclid`,
 * `waves_ref`, an email), values with other characters or too long, and values
 * that look like an id. Never throws; `{}` when there is nothing usable.
 */
export function campaignFromInstallReferrer(raw: string | null | undefined): InstallCampaign {
  const out: InstallCampaign = {};
  if (!raw) return out;
  const text = raw.trim();
  if (!text) return out;
  const attempt = text.includes('=') ? text : safeDecode(text);
  for (const pair of attempt.split('&')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const key = safeDecode(pair.slice(0, eq)).trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(CAMPAIGN_KEYS, key)) continue;
    const prop = CAMPAIGN_KEYS[key as keyof typeof CAMPAIGN_KEYS];
    if (out[prop] !== undefined) continue;
    const value = campaignValue(pair.slice(eq + 1));
    if (value) out[prop] = value;
  }
  return out;
}

/**
 * Once per install, turn the Play referrer into a waiting referral code.
 *
 * Everything outside is injected so this is testable: `read` is the native
 * module (null on any failure), `done`/`markDone` remember that the question
 * was asked, `pending` is the same store a deep link writes to. A code that is
 * already waiting (it came from a deep link) is never replaced. The question
 * is marked asked before the answer is used, so a failed read is not retried
 * on every launch: the install referrer is a one-time thing.
 */
export async function captureInstallReferrer(deps: {
  read: () => Promise<string | null>;
  done: () => Promise<boolean>;
  markDone: () => Promise<void>;
  pending: Pick<PendingReferralStore, 'peek' | 'remember'>;
}): Promise<string | null> {
  try {
    if (await deps.done()) return null;
    await deps.markDone();
    const code = referralCodeFromInstallReferrer(await deps.read());
    if (!code) return null;
    if (await deps.pending.peek()) return null;
    await deps.pending.remember(code);
    return code;
  } catch {
    return null;
  }
}

// ── what the server says ────────────────────────────────────────────────────

export interface MyReferral {
  code: string;
  /** Friends who claimed this person's code, rewarded or not. */
  invited: number;
  /** Claimed, not yet rewarded: the friend has not recorded a shared expense yet. */
  pending: number;
  rewarded: number;
  daysEarned: number;
  daysCap: number;
  daysRemaining: number;
}

function whole(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

/** `waves_my_referral()` as the screen wants it; null for anything unexpected. */
export function parseMyReferral(raw: unknown): MyReferral | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (row.ok !== true) return null;
  const code = normalizeReferralCode(typeof row.code === 'string' ? row.code : null);
  const invited = whole(row.invited);
  const pending = whole(row.pending);
  const rewarded = whole(row.rewarded);
  const daysEarned = whole(row.days_earned);
  const daysCap = whole(row.days_cap);
  const daysRemaining = whole(row.days_remaining);
  if (
    code === null ||
    invited === null ||
    pending === null ||
    rewarded === null ||
    daysEarned === null ||
    daysCap === null ||
    daysRemaining === null
  ) {
    return null;
  }
  return { code, invited, pending, rewarded, daysEarned, daysCap, daysRemaining };
}

export type ReferralRefusal =
  | 'UNKNOWN_CODE'
  | 'SELF_REFERRAL'
  | 'ALREADY_CLAIMED'
  | 'NOT_NEW_USER'
  | 'NO_SUCH_PROFILE'
  | 'ACCOUNT_REQUIRED';

export type ClaimOutcome = { ok: true } | { ok: false; reason: ReferralRefusal | 'UNKNOWN' };

const REFUSALS: readonly string[] = [
  'UNKNOWN_CODE',
  'SELF_REFERRAL',
  'ALREADY_CLAIMED',
  'NOT_NEW_USER',
  'NO_SUCH_PROFILE',
  'ACCOUNT_REQUIRED',
];

/** `waves_claim_referral(...)` as a typed outcome. */
export function parseClaimOutcome(raw: unknown): ClaimOutcome {
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'UNKNOWN' };
  const row = raw as Record<string, unknown>;
  if (row.ok === true) return { ok: true };
  const reason = typeof row.reason === 'string' ? row.reason : '';
  return { ok: false, reason: REFUSALS.includes(reason) ? (reason as ReferralRefusal) : 'UNKNOWN' };
}

/**
 * Whether a refusal is the server's last word, so a remembered code should be
 * dropped. `ACCOUNT_REQUIRED` is not (the person is still a guest and may finish
 * signing up), and an unrecognised answer is not either: keep the code rather
 * than lose it to a build that does not know a newer reason.
 */
export function isDefinitiveRefusal(reason: ReferralRefusal | 'UNKNOWN'): boolean {
  return reason !== 'ACCOUNT_REQUIRED' && reason !== 'UNKNOWN';
}

// ── what the card says ──────────────────────────────────────────────────────

export interface DaysCopy {
  /** "{earned} of {cap} days earned" */
  progress: string;
  /** "You have earned all {cap} days" */
  capReached: string;
}

/** The progress line, or the cap-reached sentence once nothing more can be earned. */
export function daysEarnedText(
  state: Pick<MyReferral, 'daysEarned' | 'daysCap' | 'daysRemaining'>,
  copy: DaysCopy,
): string {
  const template = state.daysRemaining <= 0 ? copy.capReached : copy.progress;
  return template
    .replace('{earned}', String(state.daysEarned))
    .replace('{cap}', String(state.daysCap));
}

/** Earned days as a 0-1 fraction of the cap, for the progress bar. */
export function daysFraction(state: Pick<MyReferral, 'daysEarned' | 'daysCap'>): number {
  if (state.daysCap <= 0) return 0;
  return Math.min(1, Math.max(0, state.daysEarned / state.daysCap));
}

/** The days-earned marks along the progress path, in order. */
export const REFERRAL_MILESTONES = [0, 10, 20, 30] as const;

export interface ReferralMilestone {
  value: number;
  reached: boolean;
}

/** Which marks on the path are reached: a mark is reached once `daysEarned` is at least its value. */
export function referralMilestones(daysEarned: number): ReferralMilestone[] {
  return REFERRAL_MILESTONES.map((value) => ({ value, reached: daysEarned >= value }));
}

// ── the code waiting for an account ─────────────────────────────────────────

/** Long enough to get through the stores and a first sign-up; short enough not to outlive its welcome. */
export const PENDING_REFERRAL_TTL_MS = 3 * 24 * 60 * 60 * 1000;

const PENDING_KEY = 'waves.pendingReferral';

export interface KeyValue {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface PendingReferralStore {
  remember(code: string): Promise<void>;
  /** The waiting code, or null when none, stale or unreadable. Not consumed: it is cleared after the claim is answered. */
  peek(): Promise<string | null>;
  clear(): Promise<void>;
}

/**
 * Where a referral code waits between opening the link and having an account,
 * the way `pendingInvite` keeps a group invite. Never allowed to fail loudly: a
 * lost note costs the friend a tap on the link again, never a sign-in.
 */
export function makePendingReferralStore(
  storage: KeyValue,
  now: () => number = Date.now,
): PendingReferralStore {
  const clear = async (): Promise<void> => {
    try {
      await storage.removeItem(PENDING_KEY);
    } catch {
      // The note expires on its own.
    }
  };
  return {
    async remember(code) {
      const normalized = normalizeReferralCode(code);
      if (!normalized) return;
      try {
        await storage.setItem(PENDING_KEY, JSON.stringify({ code: normalized, at: now() }));
      } catch {
        // See above: a lost note costs a tap.
      }
    },
    async peek() {
      try {
        const raw = await storage.getItem(PENDING_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { code?: unknown; at?: unknown };
        if (typeof parsed.code !== 'string' || typeof parsed.at !== 'number') return null;
        const age = now() - parsed.at;
        if (age < 0 || age > PENDING_REFERRAL_TTL_MS) {
          await clear();
          return null;
        }
        return normalizeReferralCode(parsed.code);
      } catch {
        return null;
      }
    },
    clear,
  };
}
