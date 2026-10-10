/**
 * Make and upload the low-resolution copy of an image that was just stored.
 *
 * Called by `putImage` after the original has landed, fire-and-forget: the
 * original is what matters, and an image without a thumbnail still works —
 * other phones fall back to shrinking the original themselves. The bytes come
 * from the upload itself (written to a scratch file, because the manipulator
 * reads files), and the result is also seeded into this phone's thumbnail store
 * so the uploader never downloads what it just made.
 */

import { randomUUID } from 'expo-crypto';
import { decode } from 'base64-arraybuffer';
import { File, Paths } from 'expo-file-system';

import { thumbnailBase64 } from '@/lib/image';

import { putImage, type PutImageInput } from './index';
import { thumbPathFor } from './thumbKey';
import { saveThumb } from './thumbStore';

export async function uploadThumbnailFor(
  input: PutImageInput,
  original: ArrayBuffer,
): Promise<void> {
  const scratch = new File(Paths.cache, `thumb-src-${randomUUID()}`);
  try {
    scratch.write(new Uint8Array(original));
    const base64 = await thumbnailBase64(scratch.uri);
    if (!base64) return;

    // A group is what a thumbnail is filed (and evicted) under. Covers, receipts
    // and proofs all name one; an image with none is not one this store keeps.
    if (input.groupId) {
      saveThumb(
        { bucket: input.bucket, path: input.path, groupId: input.groupId },
        new Uint8Array(decode(base64)),
      );
    }
    await putImage({
      ...input,
      path: thumbPathFor(input.path),
      base64,
      contentType: 'image/jpeg',
    });
  } catch {
    // Best-effort — see the module comment.
  } finally {
    try {
      if (scratch.exists) scratch.delete();
    } catch {
      // A stray scratch file is reclaimed with the OS cache.
    }
  }
}
