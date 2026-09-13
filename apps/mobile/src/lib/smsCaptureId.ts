/**
 * A capture id that is the same every time for the same bank message.
 *
 * Normal captures get a random id; the point of `clientMutationId` is that a
 * retry after a flaky network cannot double-post (ADR-005). An import needs
 * something stronger, because the duplicate does not come from a retry — it
 * comes from a person. They paste last month's messages again next week, and
 * the second paste has no memory of the first.
 *
 * So the id is derived from the message itself, through `dedupeKey` — the
 * bank's own reference where there is one, amount-plus-day-plus-merchant where
 * there is not. `captures.id` is the primary key, and `capture.create` answers
 * a second arrival of an id the caller already owns with the success it already
 * achieved rather than a second row (see `createCapture` in
 * `supabase/functions/sync/index.ts`, which is deliberately not an upsert — a
 * draft since filed into a group must not be resurrected as `open`). So a
 * re-paste is a no-op at the only layer that actually decides: the database.
 *
 * The owner is part of the seed because two people on one phone pasting the
 * same statement are two people's drafts, not one.
 *
 * This is the module the deleted `lib/importId.ts` was, rebuilt for captures
 * rather than expenses. The digest-shaping half lives in `./uuid8` for the same
 * reason it did then: importing expo-crypto drags React Native in with it, and
 * a well-formed id that is not *stable* de-duplicates nothing while looking
 * perfectly fine.
 */

import * as Crypto from 'expo-crypto';

import { uuidFromDigest } from '@/lib/uuid8';

/** The stable id for the draft one bank message becomes, for one person. */
export async function smsCaptureId(ownerId: string, key: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `waves:sms-draft:${ownerId}:${key}`,
  );
  return uuidFromDigest(digest);
}
