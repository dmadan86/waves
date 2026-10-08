/**
 * voice-agent under failure (docs/voice-failure-modes.md): one test per matrix
 * row. Every failure must end as a fast 503 VOICE_AGENT_UNAVAILABLE (or a
 * recovered answer from the next provider), never a hang, and never a charged
 * command.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { breaker, clearContextCache, handleVoiceAgent, type Deps, type Limits } from './handler.ts';

const ME = 'profile-me';

function table(rows: unknown[], error: unknown = null) {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  for (const m of ['select', 'is', 'order', 'limit', 'in', 'eq']) q[m] = chain;
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: error ? null : rows, error });
  return q;
}

type FetchImpl = (url: string, init: RequestInit) => Response | Promise<Response>;

interface Over {
  fetchImpl?: FetchImpl;
  env?: Record<string, string>;
  limits?: Partial<Limits>;
  /** Quota RPC: an error, or a promise that resolves only when released. */
  quota?: 'error' | 'hang';
  groupsError?: boolean;
  allowlisted?: boolean;
  /** Real clock instead of a frozen one (for total-budget tests). */
  realClock?: boolean;
}

function makeDeps(over: Over = {}) {
  let releaseQuota: () => void = () => {};
  const quotaHeld = new Promise<void>((resolve) => {
    releaseQuota = resolve;
  });
  const rpc = vi.fn(async (name: string) => {
    if (name === 'waves_voice_agent_enabled') return { data: true, error: null };
    if (name === 'waves_voice_agent_quota') {
      if (over.quota === 'error') return { data: null, error: { message: 'db down' } };
      if (over.quota === 'hang') await quotaHeld;
      return { data: { used: 3, limit: 10, tier: 'pro', allowed: true }, error: null };
    }
    return { data: 0, error: null };
  });
  const tables: Record<string, unknown[]> = {
    groups: [{ id: 'g1', name: 'Goa', type: 'trip', default_currency: 'INR' }],
    group_members: [
      {
        id: 'm-me',
        group_id: 'g1',
        profile_id: ME,
        ghost_name: null,
        profile: { display_name: 'Madan' },
      },
      { id: 'm-anu', group_id: 'g1', profile_id: null, ghost_name: 'Anu', profile: null },
    ],
    group_balances: [],
  };
  const fetchMock = vi.fn(over.fetchImpl ?? (async () => new Response('{}')));
  const waitUntil = vi.fn();
  const deps: Deps = {
    env: (n) =>
      ({ DEEPGRAM_API_KEY: 'dg', OPENROUTER_API_KEY: 'or', GEMINI_API_KEY: 'ge', ...over.env })[n],
    caller: {
      auth: { getUser: async () => ({ data: { user: { id: ME } }, error: null }) },
      from: (t: string) =>
        t === 'groups' && over.groupsError
          ? table([], { message: 'statement timeout' })
          : table(tables[t] ?? []),
    },
    service: {
      rpc,
      from: () => {
        const q: Record<string, unknown> = {};
        const chain = () => q;
        for (const m of ['select', 'eq']) q[m] = chain;
        q.maybeSingle = async () => ({
          data: over.allowlisted ? { profile_id: ME } : null,
          error: null,
        });
        return q;
      },
    },
    fetch: fetchMock as unknown as typeof fetch,
    now: over.realClock ? () => Date.now() : () => 0,
    rateLimit: async () => undefined,
    limits: over.limits,
    waitUntil,
  } as Deps;
  return { deps, rpc, fetchMock, waitUntil, releaseQuota };
}

const textRequest = () =>
  new Request('https://x/voice-agent', {
    method: 'POST',
    body: JSON.stringify({
      schemaVersion: 1,
      transcript: 'I paid 1200 for dinner with Anu',
      locale: 'en',
      today: '2026-10-07',
      groupId: 'g1',
    }),
  });

const clipRequest = () =>
  new Request('https://x/voice-agent', {
    method: 'POST',
    body: JSON.stringify({
      schemaVersion: 1,
      audioBase64: btoa('audio'),
      mimeType: 'audio/m4a',
      durationMs: 4000,
      locale: 'en',
      today: '2026-10-07',
      groupId: 'g1',
    }),
  });

const goodExpense = {
  groupId: 'g1',
  description: 'Dinner',
  amountMinor: '120000',
  currency: 'INR',
  paidByMemberId: 'm-me',
  split: { mode: 'equal', shares: [{ memberId: 'm-me' }, { memberId: 'm-anu' }] },
};

/** An OpenRouter/OpenAI-style completion with one good tool call. */
const goodCompletion = () =>
  new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            tool_calls: [
              { function: { name: 'add_expense', arguments: JSON.stringify(goodExpense) } },
            ],
          },
        },
      ],
    }),
  );
/** A Gemini answer with one good function call. */
const goodGemini = () =>
  new Response(
    JSON.stringify({
      candidates: [
        { content: { parts: [{ functionCall: { name: 'add_expense', args: goodExpense } }] } },
      ],
    }),
  );
const deepgram = (transcript: string) =>
  new Response(JSON.stringify({ results: { channels: [{ alternatives: [{ transcript }] }] } }));

/** A fetch that never answers until its signal aborts — a provider that hangs. */
const hang = (_url: string, init: RequestInit): Promise<Response> =>
  new Promise((_, reject) => {
    init.signal?.addEventListener('abort', () =>
      reject(new DOMException('The operation was aborted.', 'AbortError')),
    );
  });

const isOr = (url: string) => url.includes('openrouter.ai');
const isGemini = (url: string) => url.includes('generativelanguage');

const refunds = (rpc: ReturnType<typeof makeDeps>['rpc']) =>
  rpc.mock.calls.filter(([name]) => name === 'waves_voice_agent_refund').length;
const reserved = (rpc: ReturnType<typeof makeDeps>['rpc']) =>
  rpc.mock.calls.some(([name]) => name === 'waves_voice_agent_quota');

const UNAVAILABLE = { status: 503, code: 'VOICE_AGENT_UNAVAILABLE' };

beforeEach(() => {
  clearContextCache();
  breaker.reset();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('Deepgram (clip transcription)', () => {
  it('down (503): 503 VOICE_AGENT_UNAVAILABLE, refunded, no LLM call', async () => {
    const { deps, rpc, fetchMock } = makeDeps({
      fetchImpl: (url) =>
        url.includes('deepgram') ? new Response('down', { status: 503 }) : goodCompletion(),
    });
    await expect(handleVoiceAgent(clipRequest(), deps)).rejects.toMatchObject(UNAVAILABLE);
    expect(refunds(rpc)).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('401 (bad key): the same honest 503, refunded', async () => {
    const { deps, rpc } = makeDeps({ fetchImpl: () => new Response('no', { status: 401 }) });
    await expect(handleVoiceAgent(clipRequest(), deps)).rejects.toMatchObject(UNAVAILABLE);
    expect(refunds(rpc)).toBe(1);
  });

  it('slow: aborted at the STT budget, 503, refunded', async () => {
    const signals: AbortSignal[] = [];
    const { deps, rpc } = makeDeps({
      limits: { sttMs: 30 },
      fetchImpl: (url, init) => {
        signals.push(init.signal as AbortSignal);
        return hang(url, init);
      },
    });
    const started = Date.now();
    await expect(handleVoiceAgent(clipRequest(), deps)).rejects.toMatchObject(UNAVAILABLE);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(signals[0]?.aborted).toBe(true);
    expect(refunds(rpc)).toBe(1);
  });

  it('a breaker open on Deepgram fails a clip fast, before reserving a command', async () => {
    const { deps: failing } = makeDeps({ fetchImpl: () => new Response('x', { status: 500 }) });
    for (let i = 0; i < 3; i++) await handleVoiceAgent(clipRequest(), failing).catch(() => null);
    const { deps, rpc, fetchMock } = makeDeps({ fetchImpl: () => deepgram('dinner') });
    await expect(handleVoiceAgent(clipRequest(), deps)).rejects.toMatchObject(UNAVAILABLE);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reserved(rpc)).toBe(false);
  });
});

describe('LLM chain (OpenRouter → Gemini)', () => {
  it('down (5xx everywhere): 503 VOICE_AGENT_UNAVAILABLE, refunded once', async () => {
    const { deps, rpc, fetchMock } = makeDeps({
      fetchImpl: () => new Response('bad gateway', { status: 502 }),
    });
    await expect(handleVoiceAgent(textRequest(), deps)).rejects.toMatchObject(UNAVAILABLE);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(refunds(rpc)).toBe(1);
  });

  it('429 on OpenRouter falls through to Gemini: answered, not refunded', async () => {
    const { deps, rpc } = makeDeps({
      fetchImpl: (url) =>
        isOr(url) ? new Response('rate limited', { status: 429 }) : goodGemini(),
    });
    const body = await (await handleVoiceAgent(textRequest(), deps)).json();
    expect(body.actions).toHaveLength(1);
    expect(refunds(rpc)).toBe(0);
  });

  it('slow OpenRouter is aborted at the per-attempt budget and Gemini answers', async () => {
    const { deps, fetchMock } = makeDeps({
      limits: { llmAttemptMs: 40, minAttemptMs: 10 },
      fetchImpl: (url, init) => (isOr(url) ? hang(url, init) : goodGemini()),
    });
    const started = Date.now();
    const body = await (await handleVoiceAgent(textRequest(), deps)).json();
    expect(body.actions).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(fetchMock.mock.calls.filter(([u]) => isGemini(u as string))).toHaveLength(1);
  });

  it('timeout everywhere: the total budget ends it with a refunded 503', async () => {
    const { deps, rpc, fetchMock } = makeDeps({
      realClock: true,
      limits: { totalMs: 120, llmAttemptMs: 100, minAttemptMs: 50 },
      fetchImpl: hang,
    });
    const started = Date.now();
    await expect(handleVoiceAgent(textRequest(), deps)).rejects.toMatchObject(UNAVAILABLE);
    // One full attempt, then too little budget left to start another.
    expect(Date.now() - started).toBeLessThan(400);
    expect(fetchMock.mock.calls.length).toBeLessThan(3);
    expect(refunds(rpc)).toBe(1);
  });

  it('a body that is not JSON counts as a failure and the next provider answers', async () => {
    const { deps } = makeDeps({
      fetchImpl: (url) => (isOr(url) ? new Response('<html>oops</html>') : goodGemini()),
    });
    const body = await (await handleVoiceAgent(textRequest(), deps)).json();
    expect(body.actions).toHaveLength(1);
  });

  it('malformed tool output everywhere: an "ask again", refunded, never an action', async () => {
    const garbage = () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { tool_calls: [{ function: { name: 'nope', arguments: '{' } }] } }],
          candidates: [{ content: { parts: [{ functionCall: { name: 'nope', args: {} } }] } }],
        }),
      );
    const { deps, rpc } = makeDeps({ fetchImpl: garbage });
    const body = await (await handleVoiceAgent(textRequest(), deps)).json();
    expect(body.actions).toEqual([]);
    expect(body.clarify).toBeTruthy();
    expect(body.quota.used).toBe(2);
    expect(refunds(rpc)).toBe(1);
  });
});

describe('circuit breaker', () => {
  it('after 3 OpenRouter failures, later requests go straight to Gemini', async () => {
    const urls: string[] = [];
    const { deps } = makeDeps({
      env: { OPENROUTER_MODELS: 'x/only' },
      fetchImpl: (url) => {
        urls.push(url);
        return isOr(url) ? new Response('down', { status: 503 }) : goodGemini();
      },
    });
    for (let i = 0; i < 3; i++) await handleVoiceAgent(textRequest(), deps);
    expect(breaker.isOpen('openrouter')).toBe(true);
    urls.length = 0;
    const body = await (await handleVoiceAgent(textRequest(), deps)).json();
    expect(body.actions).toHaveLength(1);
    expect(urls.some(isOr)).toBe(false);
  });

  it('with every provider open it fails fast: no fetch, no reservation', async () => {
    for (let i = 0; i < 3; i++) {
      breaker.failure('openrouter');
      breaker.failure('gemini');
    }
    const { deps, rpc, fetchMock } = makeDeps({ fetchImpl: goodCompletion });
    await expect(handleVoiceAgent(textRequest(), deps)).rejects.toMatchObject(UNAVAILABLE);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reserved(rpc)).toBe(false);
  });

  it('a success resets the count', async () => {
    breaker.failure('openrouter');
    breaker.failure('openrouter');
    const { deps } = makeDeps({ fetchImpl: goodCompletion });
    await handleVoiceAgent(textRequest(), deps);
    breaker.failure('openrouter');
    expect(breaker.isOpen('openrouter')).toBe(false);
  });
});

describe('Supabase (database) failures', () => {
  it('quota RPC errors: 503, nothing spent, nothing to refund', async () => {
    const { deps, rpc, fetchMock } = makeDeps({ quota: 'error', fetchImpl: goodCompletion });
    await expect(handleVoiceAgent(textRequest(), deps)).rejects.toMatchObject(UNAVAILABLE);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refunds(rpc)).toBe(0);
  });

  it('quota RPC hangs: 503 at the DB budget, and a late reservation is refunded', async () => {
    const { deps, rpc, waitUntil, releaseQuota } = makeDeps({
      quota: 'hang',
      limits: { dbMs: 30 },
      fetchImpl: goodCompletion,
    });
    await expect(handleVoiceAgent(textRequest(), deps)).rejects.toMatchObject(UNAVAILABLE);
    expect(refunds(rpc)).toBe(0);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    releaseQuota();
    await waitUntil.mock.calls[0]![0];
    expect(refunds(rpc)).toBe(1);
  });

  it('context read fails after the reservation: the command is refunded', async () => {
    const { deps, rpc } = makeDeps({ groupsError: true, fetchImpl: goodCompletion });
    await expect(handleVoiceAgent(textRequest(), deps)).rejects.toMatchObject({ status: 500 });
    expect(refunds(rpc)).toBe(1);
  });
});

describe('chaos injection', () => {
  const chaos = (flags: string) => ({ VOICE_CHAOS_ENABLED: '1', VOICE_CHAOS: flags });

  it('llm-down for an allowlisted caller: 503, refunded, real providers never called', async () => {
    const { deps, rpc, fetchMock } = makeDeps({
      env: chaos('llm-down'),
      allowlisted: true,
      fetchImpl: goodCompletion,
    });
    await expect(handleVoiceAgent(textRequest(), deps)).rejects.toMatchObject(UNAVAILABLE);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refunds(rpc)).toBe(1);
  });

  it('llm-slow runs into the per-attempt deadline, not a hang', async () => {
    const { deps } = makeDeps({
      env: chaos('llm-slow'),
      allowlisted: true,
      limits: { llmAttemptMs: 20, minAttemptMs: 5 },
    });
    await expect(handleVoiceAgent(textRequest(), deps)).rejects.toMatchObject(UNAVAILABLE);
  });

  it('llm-garbage gives the refunded "ask again"', async () => {
    const { deps, rpc } = makeDeps({ env: chaos('llm-garbage'), allowlisted: true });
    const body = await (await handleVoiceAgent(textRequest(), deps)).json();
    expect(body.clarify).toBeTruthy();
    expect(refunds(rpc)).toBe(1);
  });

  it('deepgram-down / deepgram-slow fail a clip with a refunded 503', async () => {
    for (const flag of ['deepgram-down', 'deepgram-slow']) {
      breaker.reset();
      const { deps, rpc } = makeDeps({
        env: chaos(flag),
        allowlisted: true,
        limits: { sttMs: 20 },
      });
      await expect(handleVoiceAgent(clipRequest(), deps)).rejects.toMatchObject(UNAVAILABLE);
      expect(refunds(rpc)).toBe(1);
    }
  });

  it('is never active for a caller off the allowlist, or without VOICE_CHAOS_ENABLED', async () => {
    const off = makeDeps({ env: chaos('llm-down'), fetchImpl: goodCompletion });
    expect((await (await handleVoiceAgent(textRequest(), off.deps)).json()).actions).toHaveLength(
      1,
    );
    const disabled = makeDeps({
      env: { VOICE_CHAOS: 'llm-down' },
      allowlisted: true,
      fetchImpl: goodCompletion,
    });
    expect(
      (await (await handleVoiceAgent(textRequest(), disabled.deps)).json()).actions,
    ).toHaveLength(1);
  });
});
