/**
 * Where an image's low-resolution copy lives, and how big it is.
 *
 * Every image the app uploads into a group (a receipt on an expense, a payment
 * proof, a group cover) gets a small JPEG beside it at `<path>.thumb.jpg`,
 * uploaded by the same client through the same signed-upload door. The key is
 * derived from the original's, so no row has to carry it, and `r2-sign`
 * authorises a thumbnail exactly as it authorises its original. The edge keeps
 * the same suffix in `supabase/functions/_shared/r2.ts`; the two must agree.
 *
 * Pure — no native imports — so it can be tested and shared freely.
 */

import type { LogicalBucket } from './index';

export const THUMB_SUFFIX = '.thumb.jpg';

/** Longest edge of a thumbnail. Sharp on a phone-sized tile, ~20–40 KB as JPEG. */
export const THUMB_MAX_EDGE = 320;

/** JPEG quality for a thumbnail. A tile hides compression a full screen would not. */
export const THUMB_QUALITY = 0.6;

/**
 * The buckets whose images belong to a group and that the sync mirror can find,
 * so are worth keeping a small copy of on every member's phone. Not here:
 * avatars and personal captures (neither is a group's shared record), and the
 * legacy `receipts` bucket (scans read by OCR, and the pre-gallery kept bill,
 * which no row points at — the app only learns it exists by asking for it).
 */
export const THUMB_BUCKETS: ReadonlySet<LogicalBucket> = new Set<LogicalBucket>([
  'expense-attachments',
  'settlement-proofs',
  'group-photos',
]);

/** The thumbnail key for an object path. */
export function thumbPathFor(path: string): string {
  return `${path}${THUMB_SUFFIX}`;
}

/** True when `path` already names a thumbnail (so it never gets one of its own). */
export function isThumbPath(path: string): boolean {
  return path.endsWith(THUMB_SUFFIX) && path.length > THUMB_SUFFIX.length;
}

/** Whether an upload to `bucket` at `path` should have a thumbnail made beside it. */
export function wantsThumbnail(bucket: LogicalBucket, path: string): boolean {
  return THUMB_BUCKETS.has(bucket) && !isThumbPath(path);
}
