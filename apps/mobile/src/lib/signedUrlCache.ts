/**
 * Signed URLs, minted once per object and shared until they are nearly spent.
 *
 * Every private image (a group cover, an avatar, a kept bill) is read through a
 * signed URL that lives for an hour. Each `useSignedUrl` used to mint its own on
 * mount — one request per avatar per row per screen — and every mint carries a
 * new token, so expo-image, which caches by URL, saw a new image each time and
 * downloaded the same bytes again. Here one URL per object is kept and handed
 * to every reader until it is close enough to expiry to be worth replacing;
 * readers asking at the same moment share one request.
 *
 * What is not kept: a null (the object is not there yet, or not visible — it
 * may be a second from now, after an upload) and a failure (a retry must really
 * retry). The one exception is a definite "no such object" (`SIGNED_URL_ABSENT`):
 * the kept-bill probe asks for a path on every focus of every expense that has no
 * bill, and each ask is a 404 from the signer, so that answer is remembered for
 * `absentForMs` rather than re-asked. An upload or delete of an object calls `invalidate`, because covers
 * and avatars are overwritten in place at the same path and the old URL would
 * otherwise keep showing the old cached bytes.
 */

export interface SignedUrlCacheOptions {
  /** How long a minted URL is served for before a fresh one is minted. */
  freshForMs: number;
  /** How long a definite "no such object" answer is served before asking again. */
  absentForMs?: number;
  now?: () => number;
}

/** What a mint returns when the signer said the object does not exist (a 404,
 *  as opposed to a failure that may pass). Served as null, and remembered. */
export const SIGNED_URL_ABSENT = Symbol('signed-url-absent');

export type MintResult = string | null | typeof SIGNED_URL_ABSENT;

export interface SignedUrlCache {
  get(key: string, mint: () => Promise<MintResult>): Promise<string | null>;
  invalidate(key: string): void;
  clear(): void;
}

export function createSignedUrlCache({
  freshForMs,
  absentForMs = 0,
  now = Date.now,
}: SignedUrlCacheOptions): SignedUrlCache {
  const minted = new Map<string, { url: string; at: number }>();
  const absent = new Map<string, number>();
  const inFlight = new Map<string, Promise<string | null>>();
  // Bumped by invalidate/clear, so a mint that was already on the wire when the
  // object changed does not store the URL of what was there before.
  const versions = new Map<string, number>();
  let epoch = 0;
  const versionOf = (key: string): string => `${epoch}:${versions.get(key) ?? 0}`;

  return {
    get(key, mint) {
      const hit = minted.get(key);
      if (hit && now() - hit.at < freshForMs) return Promise.resolve(hit.url);

      const absentAt = absent.get(key);
      if (absentAt !== undefined) {
        if (now() - absentAt < absentForMs) return Promise.resolve(null);
        absent.delete(key);
      }

      const pending = inFlight.get(key);
      if (pending) return pending;

      // Aged from when the request left, not when it came back: the server
      // started the URL's clock no later than that.
      const startedAt = now();
      const startedVersion = versionOf(key);
      const request = mint()
        .then((result) => {
          if (result === SIGNED_URL_ABSENT) {
            if (absentForMs > 0 && versionOf(key) === startedVersion) absent.set(key, startedAt);
            return null;
          }
          if (result && versionOf(key) === startedVersion) {
            minted.set(key, { url: result, at: startedAt });
          }
          return result;
        })
        .finally(() => {
          if (inFlight.get(key) === request) inFlight.delete(key);
        });
      inFlight.set(key, request);
      return request;
    },

    invalidate(key) {
      minted.delete(key);
      absent.delete(key);
      inFlight.delete(key);
      versions.set(key, (versions.get(key) ?? 0) + 1);
    },

    clear() {
      minted.clear();
      absent.clear();
      inFlight.clear();
      versions.clear();
      epoch += 1;
    },
  };
}

/**
 * Minted URLs live an hour (`SIGNED_URL_TTL_SECONDS` in lib/storage and the
 * r2-sign function). Serve one for 45 minutes, so whoever receives it last
 * still has a quarter of an hour on it — `useSignedUrl` re-asks well inside
 * that and gets a fresh one.
 */
export const SIGNED_URL_FRESH_MS = 45 * 60 * 1000;

/** A "no such object" answer is served for ten minutes: long enough that a
 *  screen focused over and over does not hammer the signer, short enough that a
 *  bill another member kept on their phone turns up without a restart. This
 *  device's own upload or delete invalidates it at once. */
export const SIGNED_URL_ABSENT_MS = 10 * 60 * 1000;

/** The app's one cache: images from `lib/storage`'s `imageUrl`. */
export const signedUrls = createSignedUrlCache({
  freshForMs: SIGNED_URL_FRESH_MS,
  absentForMs: SIGNED_URL_ABSENT_MS,
});

export function signedUrlKey(bucket: string, path: string): string {
  return `${bucket}|${path}`;
}
