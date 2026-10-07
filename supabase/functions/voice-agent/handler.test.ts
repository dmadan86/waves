/**
 * The whole voice-agent flow with stubbed Supabase, Deepgram and Anthropic:
 * gating order, quota reserve/refund, escalation and the clarify fallback.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  DEEPSEEK_ESCALATION_MODEL,
  DEEPSEEK_PRIMARY_MODEL,
  ESCALATION_MODEL,
  handleVoiceAgent,
  llmChain,
  PRIMARY_MODEL,
  type Deps,
} from './handler.ts';

const ME = 'profile-me';

function table(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  for (const m of ['select', 'is', 'order', 'limit', 'in']) q[m] = chain;
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
  return q;
}

function makeDeps(over: {
  enabled?: boolean;
  quota?: Record<string, unknown>;
  fetchImpl?: (url: string, init: RequestInit) => Response | Promise<Response>;
  env?: Record<string, string>;
}) {
  const rpc = vi.fn(async (name: string) => {
    if (name === 'waves_voice_agent_enabled') return { data: over.enabled ?? true, error: null };
    if (name === 'waves_voice_agent_quota') {
      return {
        data: over.quota ?? { used: 1, limit: 10, tier: 'free', allowed: true },
        error: null,
      };
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
  const deps: Deps = {
    env: (n) => ({ DEEPGRAM_API_KEY: 'dg', ANTHROPIC_API_KEY: 'an', ...over.env })[n],
    caller: {
      auth: { getUser: async () => ({ data: { user: { id: ME } }, error: null }) },
      from: (t: string) => table(tables[t] ?? []),
    },
    service: { rpc },
    fetch: fetchMock as unknown as typeof fetch,
    now: () => 0,
    rateLimit: async () => undefined,
  };
  return { deps, rpc, fetchMock };
}

const request = (body: Record<string, unknown> = {}) =>
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
      ...body,
    }),
  });

const deepgram = (transcript: string) =>
  new Response(JSON.stringify({ results: { channels: [{ alternatives: [{ transcript }] }] } }));
const claude = (...calls: { name: string; input: unknown }[]) =>
  new Response(
    JSON.stringify({ content: calls.map((c) => ({ type: 'tool_use', id: 't', ...c })) }),
  );

const goodExpense = {
  groupId: 'g1',
  description: 'Dinner',
  amountMinor: '120000',
  currency: 'INR',
  paidByMemberId: 'm-me',
  split: { mode: 'equal', shares: [{ memberId: 'm-me' }, { memberId: 'm-anu' }] },
};

const status = async (p: Promise<Response>) => {
  try {
    return (await p).status;
  } catch (e) {
    return (e as { status: number; code: string }).code;
  }
};

describe('handleVoiceAgent', () => {
  it('503s when the flag is off, before spending anything', async () => {
    const { deps, fetchMock, rpc } = makeDeps({ enabled: false });
    await expect(handleVoiceAgent(request(), deps)).rejects.toMatchObject({
      status: 503,
      code: 'VOICE_AGENT_UNAVAILABLE',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith('waves_voice_agent_quota', expect.anything());
  });

  it('503s when a provider key is missing', async () => {
    const { deps } = makeDeps({ env: { DEEPGRAM_API_KEY: '' } });
    await expect(handleVoiceAgent(request(), deps)).rejects.toMatchObject({ status: 503 });
  });

  it('413s a clip that is too long, without reserving quota', async () => {
    const { deps, rpc } = makeDeps({});
    await expect(handleVoiceAgent(request({ durationMs: 60_001 }), deps)).rejects.toMatchObject({
      status: 413,
      code: 'VOICE_AGENT_CLIP_TOO_LONG',
    });
    expect(rpc).not.toHaveBeenCalledWith('waves_voice_agent_quota', expect.anything());
  });

  it('402s when the allowance is used up', async () => {
    const { deps } = makeDeps({ quota: { used: 10, limit: 10, tier: 'free', allowed: false } });
    await expect(handleVoiceAgent(request(), deps)).rejects.toMatchObject({
      status: 402,
      code: 'VOICE_AGENT_QUOTA',
    });
  });

  it('400s a malformed body', async () => {
    const { deps } = makeDeps({});
    expect(await status(handleVoiceAgent(request({ today: 'yesterday' }), deps))).toBe(
      'BAD_REQUEST',
    );
  });

  it('returns validated actions from the primary model', async () => {
    const { deps, fetchMock, rpc } = makeDeps({
      fetchImpl: (url) =>
        url.includes('deepgram')
          ? deepgram('dinner 1200 with Anu')
          : claude({ name: 'add_expense', input: goodExpense }),
    });
    const res = await handleVoiceAgent(request(), deps);
    const body = await res.json();
    expect(body).toMatchObject({
      schemaVersion: 1,
      transcript: 'dinner 1200 with Anu',
      quota: { used: 1, limit: 10, tier: 'free' },
    });
    expect(body.actions).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body as string).model).toBe(PRIMARY_MODEL);
    const [dgUrl, dgInit] = fetchMock.mock.calls[0]!;
    expect(dgUrl).toContain('keyterm=Goa');
    expect(dgInit.headers.Authorization).toBe('Token dg');
    expect(rpc).not.toHaveBeenCalledWith('waves_voice_agent_refund', expect.anything());
  });

  it('escalates to the stronger model when the first answer is invalid', async () => {
    let claudeCalls = 0;
    const { deps, fetchMock } = makeDeps({
      fetchImpl: (url) => {
        if (url.includes('deepgram')) return deepgram('dinner');
        claudeCalls += 1;
        return claudeCalls === 1
          ? claude({ name: 'add_expense', input: { ...goodExpense, paidByMemberId: 'made-up' } })
          : claude({ name: 'add_expense', input: goodExpense });
      },
    });
    const body = await (await handleVoiceAgent(request(), deps)).json();
    expect(body.actions).toHaveLength(1);
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body as string).model).toBe(ESCALATION_MODEL);
  });

  it('asks again (no actions) when both models fail validation', async () => {
    const { deps } = makeDeps({
      fetchImpl: (url) =>
        url.includes('deepgram') ? deepgram('uh') : claude({ name: 'add_expense', input: {} }),
    });
    const body = await (await handleVoiceAgent(request(), deps)).json();
    expect(body.actions).toEqual([]);
    expect(body.clarify).toBeTruthy();
  });

  it('422s and refunds on an empty transcript', async () => {
    const { deps, rpc } = makeDeps({ fetchImpl: () => deepgram('  ') });
    await expect(handleVoiceAgent(request(), deps)).rejects.toMatchObject({
      status: 422,
      code: 'VOICE_AGENT_NOTHING_HEARD',
    });
    expect(rpc).toHaveBeenCalledWith('waves_voice_agent_refund', { p_profile: ME });
  });

  it('refunds when a provider fails', async () => {
    const { deps, rpc } = makeDeps({ fetchImpl: () => new Response('no', { status: 500 }) });
    await expect(handleVoiceAgent(request(), deps)).rejects.toMatchObject({ status: 502 });
    expect(rpc).toHaveBeenCalledWith('waves_voice_agent_refund', { p_profile: ME });
  });
});

describe('LLM provider chain', () => {
  const env = (e: Record<string, string>) => (n: string) => e[n];

  it('leads with OpenRouter (Flash-Lite, then GPT-4.1 mini) when its key is set', () => {
    const chain = llmChain(env({ OPENROUTER_API_KEY: 'or', GEMINI_API_KEY: 'ge' }));
    expect(chain.map((s) => s.model)).toEqual([
      'google/gemini-3.5-flash-lite',
      'openai/gpt-4.1-mini',
      'gemini-flash-lite-latest',
    ]);
    expect(
      llmChain(env({ OPENROUTER_API_KEY: 'or', OPENROUTER_MODELS: 'x/a, y/b' })).map(
        (s) => s.model,
      ),
    ).toEqual(['x/a', 'y/b']);
  });

  it('leads with Gemini when its key is set, then DeepSeek', () => {
    const chain = llmChain(env({ GEMINI_API_KEY: 'ge', DEEPSEEK_API_KEY: 'ds' }));
    expect(chain.map((s) => s.provider)).toEqual(['gemini', 'gemini', 'deepseek']);
  });

  it('leads with DeepSeek when its key is set, Claude after it', () => {
    const chain = llmChain(env({ DEEPSEEK_API_KEY: 'ds', ANTHROPIC_API_KEY: 'an' }));
    expect(chain.map((s) => s.model)).toEqual([
      DEEPSEEK_PRIMARY_MODEL,
      DEEPSEEK_ESCALATION_MODEL,
      PRIMARY_MODEL,
    ]);
  });

  it('lets VOICE_LLM_PROVIDER put Claude first, and works with one provider alone', () => {
    const lead = llmChain(
      env({ DEEPSEEK_API_KEY: 'ds', ANTHROPIC_API_KEY: 'an', VOICE_LLM_PROVIDER: 'anthropic' }),
    );
    expect(lead[0].model).toBe(PRIMARY_MODEL);
    expect(llmChain(env({ DEEPSEEK_API_KEY: 'ds' })).map((s) => s.provider)).toEqual([
      'deepseek',
      'deepseek',
    ]);
    expect(llmChain(env({}))).toEqual([]);
  });

  it('reads DeepSeek tool calls and falls through to Claude when DeepSeek errors', async () => {
    const urls: string[] = [];
    const { deps } = makeDeps({
      env: { DEEPSEEK_API_KEY: 'ds' },
      fetchImpl: async (url) => {
        urls.push(url);
        if (url.includes('deepgram')) return deepgram('I paid 1200 for dinner with Anu');
        if (url.includes('deepseek') && urls.filter((u) => u.includes('deepseek')).length === 1) {
          return new Response('busy', { status: 503 });
        }
        if (url.includes('deepseek')) {
          return new Response(
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
        }
        return claude({ name: 'add_expense', input: goodExpense });
      },
    });
    const response = await handleVoiceAgent(request(), deps);
    const body = (await response.json()) as { actions: { type: string }[] };
    expect(body.actions.map((a) => a.type)).toEqual(['add_expense']);
    expect(urls.filter((u) => u.includes('deepseek'))).toHaveLength(2);
  });
});
