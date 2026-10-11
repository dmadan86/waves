/**
 * After each sync, make sure every image in the viewer's active groups has a
 * low-resolution copy on the phone, so it draws instantly and offline.
 *
 * The plan (which images, in what order, within what budget) is `thumbPlan.ts`;
 * this module is the side that touches the network: it respects the
 * "Sync over Wi-Fi & mobile data" choice, fetches two at a time, and for an
 * image uploaded before thumbnails existed falls back to downloading the
 * original once and keeping only a shrunk copy of it.
 */

import { fetch as expoFetch } from 'expo/fetch';
import { randomUUID } from 'expo-crypto';
import { decode } from 'base64-arraybuffer';
import { File, Paths } from 'expo-file-system';
import * as Network from 'expo-network';
import { Platform } from 'react-native';

import type { MirrorState } from '@waves/core';

import { thumbnailBase64 } from '@/lib/image';
import { loadSyncNetworkPreference, networkAllows } from '@/lib/syncNetwork';

import { imageUrl, restrictedImageUrl, type LogicalBucket } from './index';
import { cachedImageUri } from './imageCache';
import { thumbPathFor } from './thumbKey';
import {
  collectThumbRefs,
  planPrefetch,
  planPrune,
  runBounded,
  thumbId,
  type ThumbRef,
} from './thumbPlan';
import { cachedThumbs, evictThumbIds, saveThumb, thumbGeneration } from './thumbStore';

/** Downloads in flight at once: enough to fill a list quickly, light on a phone. */
const CONCURRENCY = 2;

/** An image that could not be fetched is not asked for again for this long. */
const RETRY_AFTER_MS = 30 * 60 * 1000;

const RESTRICTED: ReadonlySet<LogicalBucket> = new Set([
  'settlement-proofs',
  'expense-attachments',
]);

const failedAt = new Map<string, number>();
let running: Promise<void> | null = null;
let queued: MirrorState | null = null;

async function networkPermits(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    if (state.isConnected === false || state.isInternetReachable === false) return false;
    return networkAllows(await loadSyncNetworkPreference(), state.type);
  } catch {
    return false;
  }
}

async function signedUrl(ref: ThumbRef, path: string): Promise<string | null> {
  return RESTRICTED.has(ref.bucket)
    ? restrictedImageUrl(ref.bucket, ref.subjectId, path)
    : imageUrl(ref.bucket, path);
}

async function download(url: string): Promise<Uint8Array | null> {
  try {
    const response = await expoFetch(url);
    if (!response.ok) return null;
    const bytes = await response.bytes();
    return bytes.byteLength > 0 ? bytes : null;
  } catch {
    return null;
  }
}

/** Shrink a local file to thumbnail bytes. */
async function shrink(uri: string): Promise<Uint8Array | null> {
  const base64 = await thumbnailBase64(uri);
  return base64 ? new Uint8Array(decode(base64)) : null;
}

/**
 * The thumbnail's bytes: the stored thumbnail if there is one; otherwise the
 * full image this phone already cached on view, shrunk; otherwise the original,
 * downloaded once into a scratch file, shrunk, and the scratch file deleted.
 */
async function thumbnailBytes(ref: ThumbRef): Promise<Uint8Array | null> {
  const thumbUrl = await signedUrl(ref, thumbPathFor(ref.path));
  if (thumbUrl) {
    const bytes = await download(thumbUrl);
    if (bytes) return bytes;
  }

  const local = cachedImageUri(ref.bucket, ref.path);
  if (local) return shrink(local);

  const originalUrl = await signedUrl(ref, ref.path);
  if (!originalUrl) return null;
  const original = await download(originalUrl);
  if (!original) return null;
  const scratch = new File(Paths.cache, `thumb-src-${randomUUID()}`);
  try {
    scratch.write(original);
    return await shrink(scratch.uri);
  } finally {
    try {
      if (scratch.exists) scratch.delete();
    } catch {
      // Reclaimed with the OS cache.
    }
  }
}

async function runOnce(mirror: MirrorState): Promise<void> {
  const refs = collectThumbRefs(mirror);
  const cached = cachedThumbs();

  // Thumbnails of images that are gone (removed, or a group that went away
  // while the app was closed) are dropped first, so they never hold the cap.
  const live = new Set(refs.map((ref) => thumbId(ref.bucket, ref.path)));
  evictThumbIds(planPrune([...cached.values()], live, Date.now()));

  if (!(await networkPermits())) return;

  const now = Date.now();
  for (const [id, at] of failedAt) if (now - at > RETRY_AFTER_MS) failedAt.delete(id);
  const plan = planPrefetch(refs, cachedThumbs(), { skip: new Set(failedAt.keys()) });
  if (plan.length === 0) return;

  const generation = thumbGeneration();
  await runBounded(plan, CONCURRENCY, async (ref) => {
    if (generation !== thumbGeneration()) return;
    const bytes = await thumbnailBytes(ref);
    const id = thumbId(ref.bucket, ref.path);
    if (!bytes) {
      failedAt.set(id, Date.now());
      return;
    }
    if (!saveThumb(ref, bytes, generation)) failedAt.set(id, Date.now());
  });
}

/**
 * Ask for a prefetch against the mirror as it stands. One run at a time: a call
 * while one is running remembers the newest mirror and runs once more after, so
 * a burst of syncs costs one extra pass, not one per sync. Never throws.
 */
export function scheduleThumbPrefetch(mirror: MirrorState): void {
  if (Platform.OS === 'web') return;
  queued = mirror;
  if (running) return;
  running = (async () => {
    while (queued) {
      const next = queued;
      queued = null;
      try {
        await runOnce(next);
      } catch {
        // Best-effort; the next sync tries again.
      }
    }
  })().finally(() => {
    running = null;
  });
}
