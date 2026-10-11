/**
 * The on-device store of low-resolution group images: what `thumbPrefetch`
 * downloads after a sync, and what every image surface draws first — offline
 * included — before the full-resolution copy arrives.
 *
 * Unlike the receipt cache (`imageCache.ts`, in `Paths.cache`, which the OS may
 * purge), this lives in `Paths.document`: the whole point is that a group's
 * pictures are still there on a plane next week. It is bounded instead by a cap
 * with least-recently-used eviction (`thumbPlan.ts`), and erased with the rest
 * of an account's images on sign-out (`clearImageCache` calls `clearThumbs`).
 *
 * The index — which file holds which image, its size, its group and when it was
 * last drawn — is a small JSON file beside the images, read once into memory so
 * a render can ask "is there a thumbnail?" synchronously. Every call is
 * best-effort: a failure here degrades to the network path, never a thrown
 * screen.
 */

import { Directory, File, Paths } from 'expo-file-system';

import type { LogicalBucket } from './index';
import {
  entriesOfGroup,
  planEviction,
  thumbId,
  THUMB_CAP_BYTES,
  type CachedThumb,
} from './thumbPlan';

const DIR = 'image-thumbs';
const INDEX = 'index.json';

/** One thumbnail on disk. */
export interface ThumbEntry extends CachedThumb {
  readonly bucket: LogicalBucket;
  readonly path: string;
  /** The file's name inside the thumbnail directory. */
  readonly file: string;
}

let index: Map<string, ThumbEntry> | null = null;

/**
 * Bumped by {@link clearThumbs}. A download that started before a sign-out
 * captures it and refuses to write once it has moved, so a fetch still in the
 * air cannot put a departed account's picture back on disk.
 */
let generation = 0;

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function dir(): Directory {
  return new Directory(Paths.document, DIR);
}

function isEntry(value: unknown): value is ThumbEntry {
  const e = value as Partial<ThumbEntry> | null;
  return (
    !!e &&
    typeof e.id === 'string' &&
    typeof e.bucket === 'string' &&
    typeof e.path === 'string' &&
    typeof e.groupId === 'string' &&
    typeof e.file === 'string' &&
    typeof e.bytes === 'number' &&
    typeof e.lastUsed === 'number' &&
    typeof e.savedAt === 'number'
  );
}

/**
 * The index, loaded on first use. An unreadable index means the files beside it
 * are unaccounted for — they would never be counted against the cap or evicted —
 * so the directory is dropped and the store starts clean; the next prefetch
 * refills it.
 */
function load(): Map<string, ThumbEntry> {
  if (index) return index;
  const loaded = new Map<string, ThumbEntry>();
  try {
    const file = new File(dir(), INDEX);
    if (file.exists) {
      const parsed = JSON.parse(file.textSync()) as unknown;
      if (!Array.isArray(parsed)) throw new Error('bad index');
      for (const entry of parsed) if (isEntry(entry)) loaded.set(entry.id, entry);
    } else if (dir().exists) {
      dir().delete();
    }
  } catch {
    loaded.clear();
    try {
      if (dir().exists) dir().delete();
    } catch {
      // Best-effort.
    }
  }
  index = loaded;
  return loaded;
}

function persistNow(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  const entries = index;
  if (!entries) return;
  try {
    const folder = dir();
    if (!folder.exists) folder.create({ intermediates: true });
    const temp = new File(folder, `.${INDEX}.tmp`);
    temp.write(JSON.stringify([...entries.values()]));
    temp.moveSync(new File(folder, INDEX), { overwrite: true });
  } catch {
    // Best-effort: the index is rebuilt from scratch if it is ever lost.
  }
}

/** Coalesce the many small index changes (a list drawing twenty tiles) into one write. */
function persistSoon(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(persistNow, 1000);
}

function deleteFile(entry: ThumbEntry): void {
  try {
    const file = new File(dir(), entry.file);
    if (file.exists) file.delete();
  } catch {
    // Best-effort.
  }
}

function drop(ids: readonly string[]): void {
  const entries = load();
  for (const id of ids) {
    const entry = entries.get(id);
    if (!entry) continue;
    deleteFile(entry);
    entries.delete(id);
  }
}

/**
 * The local `file://` of an image's thumbnail, or null. Synchronous and cheap
 * (a map lookup and a stat), so a component can ask during render and draw the
 * small copy on its very first frame. Asking counts as a use for LRU.
 */
export function localThumbUri(
  bucket: LogicalBucket,
  path: string | null | undefined,
): string | null {
  if (!path) return null;
  try {
    const entries = load();
    const id = thumbId(bucket, path);
    const entry = entries.get(id);
    if (!entry) return null;
    const file = new File(dir(), entry.file);
    if (!file.exists) {
      entries.delete(id);
      persistSoon();
      return null;
    }
    entries.set(id, { ...entry, lastUsed: Date.now() });
    persistSoon();
    return file.uri;
  } catch {
    return null;
  }
}

/** The cached thumbnails, for the planner. */
export function cachedThumbs(): ReadonlyMap<string, ThumbEntry> {
  try {
    return load();
  } catch {
    return new Map();
  }
}

/** The current store generation — see {@link saveThumb}. */
export function thumbGeneration(): number {
  return generation;
}

/**
 * Write a thumbnail and record it, then evict least-recently-used ones until the
 * store is back under the cap. Each write gets a fresh file name, so a replaced
 * cover is a new URI and never served from an image view's memory cache under
 * the old one.
 *
 * `expectedGeneration`, when given, is the generation the caller saw before its
 * download began; a sign-out since then means the bytes are dropped.
 */
export function saveThumb(
  image: {
    readonly bucket: LogicalBucket;
    readonly path: string;
    readonly groupId: string;
    readonly version?: string | null;
  },
  bytes: Uint8Array,
  expectedGeneration?: number,
): string | null {
  if (bytes.byteLength === 0) return null;
  if (expectedGeneration !== undefined && expectedGeneration !== generation) return null;
  try {
    const entries = load();
    const id = thumbId(image.bucket, image.path);
    const now = Date.now();
    const name = `${encodeURIComponent(id)}.${now}.jpg`;
    const folder = dir();
    if (!folder.exists) folder.create({ intermediates: true });
    const temp = new File(folder, `.${name}.tmp`);
    temp.write(bytes);
    const file = new File(folder, name);
    temp.moveSync(file, { overwrite: true });

    const previous = entries.get(id);
    if (previous && previous.file !== name) deleteFile(previous);
    entries.set(id, {
      id,
      bucket: image.bucket,
      path: image.path,
      groupId: image.groupId,
      version: image.version ?? null,
      file: name,
      bytes: bytes.byteLength,
      lastUsed: now,
      savedAt: now,
    });
    drop(planEviction([...entries.values()], THUMB_CAP_BYTES, id));
    persistSoon();
    return file.uri;
  } catch {
    return null;
  }
}

/** Drop one image's thumbnail — its original was removed or replaced. */
export function evictThumb(bucket: LogicalBucket, path: string | null | undefined): void {
  if (!path) return;
  try {
    drop([thumbId(bucket, path)]);
    persistSoon();
  } catch {
    // Best-effort.
  }
}

/** Drop several thumbnails by id (the prefetcher's prune). */
export function evictThumbIds(ids: readonly string[]): void {
  if (ids.length === 0) return;
  try {
    drop(ids);
    persistSoon();
  } catch {
    // Best-effort.
  }
}

/** Drop every thumbnail of a group the viewer left, or that was deleted. */
export function evictGroupThumbs(groupId: string): void {
  try {
    drop(entriesOfGroup([...load().values()], groupId));
    persistNow();
  } catch {
    // Best-effort.
  }
}

/** Sign-out/privacy cleanup: every thumbnail, and the index, gone. */
export function clearThumbs(): void {
  generation += 1;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  index = new Map();
  try {
    const folder = dir();
    if (folder.exists) folder.delete();
  } catch {
    // Best-effort.
  }
}

/** Test seam: forget the in-memory index so the next call reloads from disk. */
export function resetThumbStoreForTests(): void {
  index = null;
  generation = 0;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}
