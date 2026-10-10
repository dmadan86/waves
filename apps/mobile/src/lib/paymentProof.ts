/**
 * The pure rules behind the "you paid" card: how many proofs a payment can
 * hold, when it may be reminded about again, and which day it was paid.
 *
 * The database is the authority on all three (`waves_attach_settlement_proof`,
 * `waves_remind_settlement_confirm`, `settlements.paid_at`); these mirror it so
 * the card can hide a button that would only be refused and say "Reminded 2h
 * ago" without a round trip.
 */

/** Proofs one payment can carry. The same number lives in the attach RPC. */
export const MAX_PROOFS = 2;

/** One reminder per payment per day. The same window lives in the remind RPC. */
export const REMIND_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function canAddProof(count: number): boolean {
  return count < MAX_PROOFS;
}

/**
 * What to do when adding a proof fails. A free account out of storage is the one
 * failure a person can act on (r2-sign answers 402 STORAGE_CAP, which the
 * storage layer raises as `StorageCapError`): it gets the upgrade prompt, the
 * same as any other upload. Everything else is an ordinary error message.
 */
export enum ProofAddFailure {
  StorageFull = 'storage-full',
  Other = 'other',
}

export function classifyProofAddFailure(caught: unknown): ProofAddFailure {
  return caught instanceof Error && caught.name === 'StorageCapError'
    ? ProofAddFailure.StorageFull
    : ProofAddFailure.Other;
}

export enum RemindUnit {
  Minutes = 'minutes',
  Hours = 'hours',
  Days = 'days',
}

export interface RemindState {
  /** Whether Remind may be offered now. */
  readonly available: boolean;
  /** How long ago the last reminder went, when there was one. */
  readonly ago: { readonly unit: RemindUnit; readonly n: number } | null;
}

/**
 * Where a payment stands on reminders. `remindedAt` is an ISO timestamp (or
 * null). A timestamp in the future (clock skew between phone and server) counts
 * as "just now" rather than as a reminder from tomorrow.
 */
export function remindState(remindedAt: string | null | undefined, now: number): RemindState {
  if (!remindedAt) return { available: true, ago: null };
  const at = Date.parse(remindedAt);
  if (Number.isNaN(at)) return { available: true, ago: null };
  const elapsed = Math.max(0, now - at);
  const minutes = Math.floor(elapsed / 60_000);
  const ago =
    minutes < 60
      ? { unit: RemindUnit.Minutes, n: Math.max(1, minutes) }
      : minutes < 24 * 60
        ? { unit: RemindUnit.Hours, n: Math.floor(minutes / 60) }
        : { unit: RemindUnit.Days, n: Math.floor(minutes / (24 * 60)) };
  return { available: elapsed >= REMIND_COOLDOWN_MS, ago };
}

/** `YYYY-MM-DD` of a Date in the device's own timezone. */
export function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The day a payment was made: the stored `paid_at`, else the day the row was
 * recorded (rows from before the column, or a queued payment not yet synced).
 */
export function paidDay(row: {
  readonly paid_at?: string | null;
  readonly initiated_at: string;
}): string {
  if (row.paid_at && DAY.test(row.paid_at)) return row.paid_at;
  const recorded = new Date(row.initiated_at);
  return Number.isNaN(recorded.getTime()) ? '' : localDay(recorded);
}

/** A picked day, held to today at the latest: nobody has paid tomorrow. */
export function clampPaidDay(day: string, now: Date): string {
  const today = localDay(now);
  return DAY.test(day) && day <= today ? day : today;
}

/** `2026-10-08` as a short, locale-aware date ("8 Oct" / "Oct 8"). Empty for a bad day. */
export function formatPaidDay(day: string, locale: string, now: Date = new Date()): string {
  if (!DAY.test(day)) return '';
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  const sameYear = date.getFullYear() === now.getFullYear();
  try {
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      ...(sameYear ? {} : { year: 'numeric' }),
    }).format(date);
  } catch {
    return day;
  }
}

/** The phone's digits as WhatsApp wants them: no `+`, no spaces. */
export function phoneDigits(phone: string | null | undefined): string {
  return (phone ?? '').replace(/\D/g, '');
}

/** Fill `{name}`, `{amount}`, `{group}` and `{date}` in a localized template. */
export function fillReminder(
  template: string,
  values: { name: string; amount: string; group: string; date: string },
): string {
  return template
    .replace(/\{name\}/g, values.name)
    .replace(/\{amount\}/g, values.amount)
    .replace(/\{group\}/g, values.group)
    .replace(/\{date\}/g, values.date)
    .trim();
}

/**
 * Where to send a reminder to someone not on Waves: the WhatsApp app, then
 * wa.me, when they have a phone; otherwise nothing, and the caller falls back to
 * the share sheet.
 */
export function reminderUrls(phone: string | null | undefined, text: string): string[] {
  const digits = phoneDigits(phone);
  if (!digits) return [];
  const encoded = encodeURIComponent(text);
  return [
    `whatsapp://send?phone=${digits}&text=${encoded}`,
    `https://wa.me/${digits}?text=${encoded}`,
  ];
}
