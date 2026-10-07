/** Deadlines and the circuit breaker the voice functions lean on. */

import { describe, expect, it, vi } from 'vitest';

import {
  CircuitBreaker,
  DeadlineExceeded,
  fetchJsonWithDeadline,
  raceDeadline,
} from './resilience.ts';
import { chaosFetch, parseChaos, upstreamOf } from './voiceChaos.ts';

describe('fetchJsonWithDeadline', () => {
  it('returns status and parsed body', async () => {
    const fetchFn = vi.fn(async () => new Response('{"a":1}', { status: 201 }));
    await expect(
      fetchJsonWithDeadline(fetchFn as unknown as typeof fetch, 'https://x', {}, 100, 't'),
    ).resolves.toEqual({ status: 201, ok: true, body: { a: 1 } });
  });

  it('reads a non-JSON body as null (malformed), not a throw', async () => {
    const fetchFn = async () => new Response('<html>');
    const out = await fetchJsonWithDeadline(fetchFn as typeof fetch, 'https://x', {}, 100, 't');
    expect(out.body).toBeNull();
  });

  it('aborts the request and throws DeadlineExceeded at the budget', async () => {
    let signal: AbortSignal | undefined;
    const fetchFn = (_: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => {
        signal = init.signal as AbortSignal;
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    await expect(
      fetchJsonWithDeadline(fetchFn as unknown as typeof fetch, 'https://x', {}, 20, 'slow'),
    ).rejects.toBeInstanceOf(DeadlineExceeded);
    expect(signal?.aborted).toBe(true);
  });

  it('passes a connection error through as itself', async () => {
    const fetchFn = async () => {
      throw new TypeError('connection refused');
    };
    await expect(
      fetchJsonWithDeadline(fetchFn as typeof fetch, 'https://x', {}, 100, 't'),
    ).rejects.toBeInstanceOf(TypeError);
  });
});

describe('raceDeadline', () => {
  it('resolves with the work when it is in time', async () => {
    await expect(raceDeadline(Promise.resolve(5), 50, () => new Error('late'))).resolves.toBe(5);
  });
  it('rejects with the given error when it is not', async () => {
    await expect(
      raceDeadline(new Promise(() => undefined), 10, () => new Error('late')),
    ).rejects.toThrow('late');
  });
});

describe('CircuitBreaker', () => {
  it('opens after N consecutive failures, for the cooldown, then half-opens', () => {
    let now = 0;
    const b = new CircuitBreaker({ threshold: 3, cooldownMs: 60_000, now: () => now });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    b.failure('p');
    b.failure('p');
    expect(b.isOpen('p')).toBe(false);
    b.failure('p');
    expect(b.isOpen('p')).toBe(true);
    expect(b.isOpen('other')).toBe(false);
    now = 59_999;
    expect(b.isOpen('p')).toBe(true);
    now = 60_000;
    expect(b.isOpen('p')).toBe(false);
    // One more failure on the trial re-opens it at once.
    b.failure('p');
    expect(b.isOpen('p')).toBe(true);
    now += 60_000;
    b.success('p');
    b.failure('p');
    expect(b.isOpen('p')).toBe(false);
  });
});

describe('chaos flags', () => {
  const env = (e: Record<string, string>) => (n: string) => e[n];

  it('are empty unless VOICE_CHAOS_ENABLED=1, and ignore unknown names', () => {
    expect(parseChaos(env({ VOICE_CHAOS: 'llm-down' })).size).toBe(0);
    expect(parseChaos(env({ VOICE_CHAOS_ENABLED: 'true', VOICE_CHAOS: 'llm-down' })).size).toBe(0);
    expect([
      ...parseChaos(env({ VOICE_CHAOS_ENABLED: '1', VOICE_CHAOS: ' LLM-down, bogus,relay-drop' })),
    ]).toEqual(['llm-down', 'relay-drop']);
  });

  it('classify upstreams by host', () => {
    expect(upstreamOf('https://api.deepgram.com/v1/listen')).toBe('deepgram');
    expect(upstreamOf('https://openrouter.ai/api/v1/chat/completions')).toBe('llm');
    expect(upstreamOf('https://generativelanguage.googleapis.com/v1beta/x')).toBe('llm');
    expect(upstreamOf('https://evil.example/openrouter.ai')).toBe('other');
    expect(upstreamOf('https://evildeepgram.com/v1/listen')).toBe('other');
    expect(upstreamOf('not a url')).toBe('other');
  });

  it('leave other hosts, and everything when no flag is set, untouched', async () => {
    const real = vi.fn(async () => new Response('{}'));
    const f = real as unknown as typeof fetch;
    expect(chaosFetch(f, new Set())).toBe(f);
    await chaosFetch(f, new Set(['llm-down']))('https://example.supabase.co/rest');
    expect(real).toHaveBeenCalledTimes(1);
    const down = await chaosFetch(f, new Set(['llm-down']))('https://openrouter.ai/api');
    expect(down.status).toBe(503);
    expect(real).toHaveBeenCalledTimes(1);
  });
});
