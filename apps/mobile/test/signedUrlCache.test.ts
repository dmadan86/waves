import { describe, expect, it, vi } from 'vitest';

import { createSignedUrlCache, signedUrlKey } from '../src/lib/signedUrlCache';

const MIN = 60 * 1000;

function setup() {
  let clock = 0;
  const cache = createSignedUrlCache({ freshForMs: 45 * MIN, now: () => clock });
  let n = 0;
  const mint = vi.fn(async () => `https://img/cover.jpg?token=${(n += 1)}`);
  return {
    cache,
    mint,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

/** A mint the test resolves by hand, to hold a request open. */
function deferred() {
  let resolve!: (url: string | null) => void;
  const promise = new Promise<string | null>((r) => (resolve = r));
  return { promise, resolve };
}

describe('signed URL cache', () => {
  it('serves the same URL to every reader while it is fresh', async () => {
    const { cache, mint, advance } = setup();
    const first = await cache.get('photos|g1/cover.jpg', mint);
    advance(44 * MIN);
    const again = await cache.get('photos|g1/cover.jpg', mint);

    expect(again).toBe(first);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('mints a new URL once the old one is past its serving window', async () => {
    const { cache, mint, advance } = setup();
    const first = await cache.get('k', mint);
    advance(45 * MIN);
    const fresh = await cache.get('k', mint);

    expect(fresh).not.toBe(first);
    expect(mint).toHaveBeenCalledTimes(2);
    // …and the new one is what is served from then on.
    advance(10 * MIN);
    expect(await cache.get('k', mint)).toBe(fresh);
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it('shares one request between readers asking at the same moment', async () => {
    const { cache } = setup();
    const pending = deferred();
    const mint = vi.fn(() => pending.promise);

    const a = cache.get('k', mint);
    const b = cache.get('k', mint);
    const c = cache.get('k', mint);
    pending.resolve('https://img/x?token=1');

    expect(await Promise.all([a, b, c])).toEqual([
      'https://img/x?token=1',
      'https://img/x?token=1',
      'https://img/x?token=1',
    ]);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('keeps different objects apart', async () => {
    const { cache, mint } = setup();
    const one = await cache.get('photos|g1/cover.jpg', mint);
    const two = await cache.get('photos|g2/cover.jpg', mint);
    expect(one).not.toBe(two);
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it('does not keep a null or a failure, so the next ask really retries', async () => {
    const { cache } = setup();
    const missing = vi.fn(async (): Promise<string | null> => null);
    expect(await cache.get('k', missing)).toBeNull();
    expect(await cache.get('k', missing)).toBeNull();
    expect(missing).toHaveBeenCalledTimes(2);

    const failing = vi.fn(async (): Promise<string | null> => {
      throw new Error('offline');
    });
    await expect(cache.get('k', failing)).rejects.toThrow('offline');
    await expect(cache.get('k', failing)).rejects.toThrow('offline');
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('forgets an object that was replaced, including a mint already on the wire', async () => {
    const { cache, mint } = setup();
    const before = await cache.get('k', mint);
    cache.invalidate('k');
    const after = await cache.get('k', mint);
    expect(after).not.toBe(before);

    // A mint that started before the upload landed must not be stored.
    const stale = deferred();
    cache.invalidate('k');
    const racing = cache.get('k', () => stale.promise);
    cache.invalidate('k'); // the upload finished meanwhile
    stale.resolve('https://img/old-bytes');
    expect(await racing).toBe('https://img/old-bytes');

    const next = await cache.get('k', mint);
    expect(next).not.toBe('https://img/old-bytes');
  });

  it('clear() drops everything (sign-out)', async () => {
    const { cache, mint } = setup();
    await cache.get('a', mint);
    await cache.get('b', mint);
    cache.clear();
    await cache.get('a', mint);
    await cache.get('b', mint);
    expect(mint).toHaveBeenCalledTimes(4);
  });
});

describe('the cache key', () => {
  it('keeps the same path in two buckets apart', () => {
    expect(signedUrlKey('avatars', 'p1.jpg')).toBe('avatars|p1.jpg');
    expect(signedUrlKey('avatars', 'p1.jpg')).not.toBe(signedUrlKey('covers', 'p1.jpg'));
  });
});
