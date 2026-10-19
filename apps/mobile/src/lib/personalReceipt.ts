/**
 * Receipt photos on personal ledger entries.
 *
 * The photo lives in the private `receipts` bucket under
 * `personal/<owner id>/<file id>.jpg`. `r2-sign` already decides that path by
 * its owner segment alone: only the signed-in owner is signed a read, write or
 * delete, and writing is a paid feature. The key itself is kept in the entry's
 * encrypted blob (`PersonalTxn.receiptKey`), so the server never learns which
 * entries have one and no migration is needed.
 *
 * Mirrors the group kept-bill flow: bytes are deleted from R2 straight away
 * (best effort — the storage sweep is the backstop), and deleting the entry
 * deletes its photo.
 */

import { randomUUID } from 'expo-crypto';

import { imageUrl, putImage, removeImage } from '@/lib/storage';

const BUCKET = 'receipts';

export function personalReceiptKey(ownerId: string, fileId: string): string {
  return `personal/${ownerId}/${fileId}.jpg`;
}

/** True only for a key under this owner's own prefix, so a crafted blob can never aim a delete elsewhere. */
export function isOwnReceiptKey(
  ownerId: string | null | undefined,
  key: string | null | undefined,
): boolean {
  if (!ownerId || !key) return false;
  const parts = key.split('/');
  return (
    parts.length === 3 && parts[0] === 'personal' && parts[1] === ownerId && parts[2]!.length > 0
  );
}

/**
 * The stored keys a save leaves behind. The entry used to point at `saved`; it
 * will now point at `current`. Anything else the form uploaded in between is
 * already gone (see `PersonalReceiptRow`), so this is at most the old photo.
 */
export function staleReceiptKeys(
  ownerId: string | null | undefined,
  saved: string | null | undefined,
  current: string | null | undefined,
): string[] {
  if (!saved || saved === current) return [];
  return isOwnReceiptKey(ownerId, saved) ? [saved] : [];
}

/** Upload a picked photo and return the key to keep on the entry. */
export async function uploadPersonalReceipt(input: {
  ownerId: string;
  base64: string;
  mimeType?: string | null;
}): Promise<string> {
  const key = personalReceiptKey(input.ownerId, randomUUID());
  await putImage({
    bucket: BUCKET,
    path: key,
    base64: input.base64,
    contentType:
      input.mimeType === 'image/png' || input.mimeType === 'image/webp'
        ? input.mimeType
        : 'image/jpeg',
    groupId: null,
  });
  return key;
}

/** Best-effort delete of one of the owner's own photos. Never throws. */
export async function removePersonalReceipt(
  ownerId: string | null | undefined,
  key: string | null | undefined,
): Promise<void> {
  if (!isOwnReceiptKey(ownerId, key)) return;
  try {
    await removeImage(BUCKET, key as string);
  } catch {
    // The sweep reclaims it; a failed delete must never block a save or a delete.
  }
}

export function personalReceiptUrl(key: string | null | undefined): Promise<string | null> {
  return imageUrl(BUCKET, key ?? null);
}
