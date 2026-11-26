/**
 * The watch ⇄ phone relay contract.
 *
 * Waves' smartwatch companions (Apple Watch, Wear OS) hold no ledger logic:
 * they send small intents to the paired phone, which does the real work through
 * the same offline queue, split math and voice parser the app already uses, and
 * relays results back. This module is that contract — the message shapes and a
 * strict decoder — kept here in `@waves/core` because it is pure (no React,
 * Supabase, Node or native deps) and is the single source of truth the phone
 * bridge and both native watch apps encode against.
 *
 * Money crosses the wire as a decimal-string of minor units (bigint has no JSON
 * form), exactly like the mutation-queue boundary (`serialiseCapture`).
 */

import { minorUnitScale } from '../money/currency';

/** Bumped only on a breaking change to the shapes below. */
export const WATCH_RELAY_VERSION = 1 as const;

/** The recent-list sizes the phone offers; the watch never asks for another. */
export const RECENT_COUNT_OPTIONS = [3, 5, 10] as const;
export type RecentCount = (typeof RECENT_COUNT_OPTIONS)[number];
export const DEFAULT_RECENT_COUNT: RecentCount = 5;

/** Clamp any stored/received number to an offered size. */
export function coerceRecentCount(value: unknown): RecentCount {
  const n = typeof value === 'number' ? value : Number(value);
  return (RECENT_COUNT_OPTIONS as readonly number[]).includes(n)
    ? (n as RecentCount)
    : DEFAULT_RECENT_COUNT;
}

/** A single row the watch renders in its recent-expenses list. */
export interface WatchRecentItem {
  /** e.g. the expense note or "Added an expense". */
  title: string;
  /** e.g. the group name, or "Personal". */
  subtitle: string;
  /** Preformatted money, e.g. "₹1,200". Formatted on the phone so the watch
   *  needs no currency tables. */
  amountText: string;
  /** Preformatted relative time, e.g. "2h ago". */
  whenText: string;
}

/**
 * Where the WATCH was when an expense was made (its own GPS, or the fix it last
 * had). Optional on every add: an older watch, or one with location off or not
 * allowed, sends none.
 */
export interface WatchLocation {
  lat: number;
  lng: number;
  /** Metres, when the watch knows it. */
  accuracy?: number;
  /** Epoch ms the fix was taken. */
  capturedAt?: number;
}

/**
 * When and where an add was made on the watch. An add can be delivered hours
 * after it was made (the watch stores it while the phone is away), so the phone
 * must not stamp its own clock or position at the moment it processes it.
 * All three are optional: an older watch sends none of them.
 */
export interface WatchAddMeta {
  /** Epoch ms the add was made on the watch. */
  madeAt?: number;
  /** The watch's UTC offset then, in minutes east of UTC (IST = 330). */
  tzOffsetMin?: number;
  location?: WatchLocation;
}

/** Messages the watch sends to the phone. */
export type WatchToPhone =
  // `id` is a stable per-intent key (a UUID the watch mints once per send). The
  // phone derives the capture id from it, so a transport-level retry of the same
  // tap is idempotent instead of creating a duplicate expense.
  // The decoded form always carries `amountMinor` in the CURRENCY's minor units
  // (see `parseWatchToPhone`); the wire carries either `amount` (whole units, sent
  // by current watches) or legacy `amountMinor` (whole units x 100).
  | ({
      t: 'quickAdd';
      id: string;
      amountMinor: string;
      currency: string;
      note: string;
    } & WatchAddMeta)
  | ({ t: 'voiceAdd'; id: string; transcript: string } & WatchAddMeta)
  // The metadata of a recorded clip sent as a file (`transferFile`); the audio
  // itself travels as the file, not in this message.
  | ({ t: 'voiceClip'; id: string; durationMs: number } & WatchAddMeta)
  | { t: 'requestRecent'; count: number }
  | { t: 'notifAction'; actionId: string; objectId: string };

/** Messages the phone sends to the watch. */
export type PhoneToWatch =
  | { t: 'recent'; items: WatchRecentItem[] }
  // `currency` is the phone's default (ISO code); the watch has no currency
  // knowledge of its own, so it books a quick-add in whatever the phone relays.
  // `locationEnabled`: the person has location for expenses on (permission granted
  // on the phone), so a watch may capture its own position with each add. Absent
  // from an older phone, which a watch reads as off.
  | { t: 'settings'; recentCount: RecentCount; currency: string; locationEnabled?: boolean }
  // `id` names the add being answered, so the watch can mark that one synced.
  | { t: 'ack'; ok: boolean; error?: string; id?: string }
  // The outcome of a voice clip, keyed by the clip's id. `text` is preformatted
  // on the phone ("₹8,000 · Renny") so the watch needs no money formatting; a failure
  // carries a short `error` code the watch words itself.
  | { t: 'voiceResult'; id: string; status: WatchVoiceStatus; text: string; error?: string };

/** `added`: written as captures; `review`: waiting on the phone; `error`: nothing saved. */
export type WatchVoiceStatus = 'added' | 'review' | 'error';

/** Longest clip the watch records, and so the most the phone will accept. */
export const WATCH_VOICE_CLIP_MAX_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A positive integer minor-unit amount as a string — no sign, at least one
 *  non-zero digit (so "0", "00" and "" are all rejected), and at most 12 digits
 *  (≈ 1 trillion minor units; rejects oversized inputs before BigInt conversion). */
function isPositiveMinor(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= 12 && /^\d+$/.test(value) && /[1-9]/.test(value)
  );
}

/**
 * The minor-unit amount of a watch quick-add, for the destination currency.
 *
 * Watches send what was dialled: `amount`, whole units. A watch built before
 * that key sent `amountMinor` as whole units x 100 whatever the currency, which
 * is right only for two-decimal currencies; for JPY (0) or KWD (3) it is rescaled
 * here, where the exponent is known. Null when it cannot be read safely.
 */
function quickAddMinor(raw: Record<string, unknown>, currency: string): string | null {
  const scale = minorUnitScale(currency.toUpperCase());
  let minor: bigint;
  if (raw.amount !== undefined) {
    if (typeof raw.amount !== 'string' || raw.amount.length > 9 || !isPositiveMinor(raw.amount)) {
      return null;
    }
    minor = BigInt(raw.amount) * scale;
  } else {
    if (!isPositiveMinor(raw.amountMinor)) return null;
    if (scale === 100n) return raw.amountMinor;
    const legacy = BigInt(raw.amountMinor);
    if (legacy % 100n !== 0n) return null;
    minor = (legacy / 100n) * scale;
  }
  const out = minor.toString();
  return out.length <= 12 ? out : null;
}

/** ISO 4217-style currency: exactly 3 ASCII letters. */
function isValidCurrency(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z]{3}$/.test(value);
}

function finiteNumber(value: unknown): number | undefined {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/** The optional when/where of an add; a field that fails validation is dropped, never the add. */
function parseAddMeta(raw: Record<string, unknown>): WatchAddMeta {
  const meta: WatchAddMeta = {};
  const madeAt = finiteNumber(raw.madeAt);
  if (madeAt !== undefined && madeAt > 0) meta.madeAt = Math.round(madeAt);
  const tz = finiteNumber(raw.tzOffsetMin);
  if (tz !== undefined && Number.isInteger(tz) && Math.abs(tz) <= 14 * 60) meta.tzOffsetMin = tz;
  const loc = raw.location;
  if (isRecord(loc)) {
    const lat = finiteNumber(loc.lat);
    const lng = finiteNumber(loc.lng);
    if (lat !== undefined && lng !== undefined && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      const place: WatchLocation = { lat, lng };
      const accuracy = finiteNumber(loc.accuracy);
      if (accuracy !== undefined && accuracy >= 0) place.accuracy = accuracy;
      const capturedAt = finiteNumber(loc.capturedAt);
      if (capturedAt !== undefined && capturedAt > 0) place.capturedAt = Math.round(capturedAt);
      meta.location = place;
    }
  }
  return meta;
}

/** How fresh a delivery must be for the phone's own position to stand in for a missing watch one. */
export const WATCH_PHONE_PLACE_MAX_AGE_MS = 2 * 60 * 1000;

/**
 * Whose position an add gets: the watch's when it sent one; else the phone's, but
 * only if the add arrived within two minutes of being made (the wearer is still
 * where the phone is); else none, since a position read hours later is wrong. An
 * add with no `madeAt` (an older watch) counts as just made, as it always did.
 */
export function watchPlaceSource(
  meta: Pick<WatchAddMeta, 'madeAt' | 'location'>,
  now: number,
): 'watch' | 'phone' | 'none' {
  if (meta.location) return 'watch';
  if (meta.madeAt === undefined || now - meta.madeAt <= WATCH_PHONE_PLACE_MAX_AGE_MS)
    return 'phone';
  return 'none';
}

/**
 * The calendar day (YYYY-MM-DD) an add was made, in the WATCH's zone.
 * `fallbackDate` is the phone's today, used when the watch sent no time (older
 * watch) or one that cannot be right (over a day ahead of the phone's clock).
 * With a time but no offset, the phone's own zone is the best guess.
 */
export function watchExpenseDate(
  meta: Pick<WatchAddMeta, 'madeAt' | 'tzOffsetMin'>,
  now: number,
  fallbackDate: string,
): string {
  const { madeAt, tzOffsetMin } = meta;
  if (madeAt === undefined || madeAt > now + 24 * 60 * 60 * 1000) return fallbackDate;
  if (tzOffsetMin === undefined) {
    const d = new Date(madeAt);
    const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return new Date(madeAt + tzOffsetMin * 60_000).toISOString().slice(0, 10);
}

/**
 * Decode an untrusted message from the watch, rejecting anything malformed.
 *
 * The native channels (WatchConnectivity, the Wearable Data Layer) hand across
 * loosely-typed dictionaries, so every field is checked before the bridge acts
 * on it — a bad `quickAdd` must never reach the mutation queue.
 *
 * Field length limits:
 *   id            ≤ 64 chars  (all message types)
 *   amount        whole units, ≤ 9 digits, or legacy amountMinor ≤ 12 digits (quickAdd)
 *   currency      exactly 3 ASCII letters, e.g. "INR" (quickAdd)
 *   note          ≤ 500 chars (quickAdd)
 *   transcript    ≤ 2000 chars (voiceAdd)
 *   actionId      ≤ 128 chars (notifAction)
 *   objectId      ≤ 128 chars (notifAction)
 */
export function parseWatchToPhone(raw: unknown): WatchToPhone | null {
  if (!isRecord(raw)) return null;
  // A watch that stamps a version must match ours; a versionless message is a
  // v1 watch and is accepted. Guards against an old intent being read with new
  // semantics after a breaking relay change.
  if (raw.version !== undefined && raw.version !== WATCH_RELAY_VERSION) return null;
  const id = typeof raw.id === 'string' && raw.id.length > 0 && raw.id.length <= 64 ? raw.id : null;
  switch (raw.t) {
    case 'quickAdd': {
      if (!id || !isValidCurrency(raw.currency) || typeof raw.note !== 'string') return null;
      if (raw.note.length > 500) return null;
      const amountMinor = quickAddMinor(raw, raw.currency);
      return amountMinor
        ? {
            t: 'quickAdd',
            id,
            amountMinor,
            currency: raw.currency,
            note: raw.note,
            ...parseAddMeta(raw),
          }
        : null;
    }
    case 'voiceAdd':
      return id &&
        typeof raw.transcript === 'string' &&
        raw.transcript.trim().length > 0 &&
        raw.transcript.length <= 2000
        ? { t: 'voiceAdd', id, transcript: raw.transcript, ...parseAddMeta(raw) }
        : null;
    case 'voiceClip': {
      // WatchConnectivity metadata is a property list: a number may arrive as
      // an Int or a Double, never a string — but accept a numeric string too.
      const ms = typeof raw.durationMs === 'string' ? Number(raw.durationMs) : raw.durationMs;
      return id && typeof ms === 'number' && Number.isFinite(ms) && ms > 0
        ? {
            t: 'voiceClip',
            id,
            durationMs: Math.min(Math.round(ms), WATCH_VOICE_CLIP_MAX_MS),
            ...parseAddMeta(raw),
          }
        : null;
    }
    case 'requestRecent':
      return { t: 'requestRecent', count: coerceRecentCount(raw.count) };
    case 'notifAction':
      return typeof raw.actionId === 'string' &&
        raw.actionId.length > 0 &&
        raw.actionId.length <= 128 &&
        typeof raw.objectId === 'string' &&
        raw.objectId.length > 0 &&
        raw.objectId.length <= 128
        ? { t: 'notifAction', actionId: raw.actionId, objectId: raw.objectId }
        : null;
    default:
      return null;
  }
}

/**
 * The phone→watch side is produced only by our own code, so it needs no
 * decoder — but this keeps the shapes honest and gives the native apps a single
 * documented envelope. `version` lets a watch ignore a newer phone it can't read.
 */
export function encodePhoneToWatch(msg: PhoneToWatch): Record<string, unknown> {
  // version after the spread: a structurally compatible `msg` carrying its own
  // `version` must not override the real one.
  return { ...msg, version: WATCH_RELAY_VERSION };
}
