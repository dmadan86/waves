import { describe, expect, it, vi } from 'vitest';

import { fetchWithTimeout } from '../src/lib/fetchWithTimeout';

const hang: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  });

describe('fetchWithTimeout', () => {
  it('aborts a database call that runs past the limit', async () => {
    vi.useFakeTimers();
    const call = fetchWithTimeout(1000, hang)('https://x.supabase.co/rest/v1/group_members');
    const settled = expect(call).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(1000);
    await settled;
    vi.useRealTimers();
  });

  it('leaves storage and functions on the plain fetch', async () => {
    const base = vi.fn(async () => new Response('ok'));
    await fetchWithTimeout(1000, base)('https://x.supabase.co/storage/v1/object/r');
    expect(base).toHaveBeenCalledWith('https://x.supabase.co/storage/v1/object/r', undefined);
  });

  it('passes a quick answer through and honours the caller abort', async () => {
    const ok = await fetchWithTimeout(
      1000,
      async () => new Response('fine'),
    )('https://x.supabase.co/rest/v1/rpc/f');
    expect(await ok.text()).toBe('fine');
    const outer = new AbortController();
    const call = fetchWithTimeout(60_000, hang)('https://x.supabase.co/rest/v1/t', {
      signal: outer.signal,
    });
    outer.abort();
    await expect(call).rejects.toThrow('aborted');
  });
});
