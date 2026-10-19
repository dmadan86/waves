import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpError } from '../_shared/auth.ts';
import { breaker, clearContextCache, handleVoiceAgent, type Deps, type Limits } from './handler.ts';
import { fixtureContext, fixtures, WS2_LANDED } from './evals/harness.ts';

type Call = { name: string; input: unknown };
type FetchImpl = (url: string, init: RequestInit) => Response | Promise<Response>;
const answer: Call = { name: 'answer_question', input: { text: 'Done.' } };
const saved = fixtures.saved.personal;
const update = (id = saved.id): Call => ({
  name: 'update_expense',
  input: { expenseId: id, place: 'Blue Tokai' },
});
const deepgram = (transcript: string) =>
  new Response(JSON.stringify({ results: { channels: [{ alternatives: [{ transcript }] }] } }));
const claude = (calls: Call[], usage?: Record<string, number>) =>
  new Response(
    JSON.stringify({ content: calls.map((c) => ({ type: 'tool_use', id: 't', ...c })), usage }),
  );

/** Route actual provider URLs, retaining each provider's native tool-call shape. */
function scriptedLlm(calls: Call[], transcript = 'at Blue Tokai'): FetchImpl {
  return (url) => {
    if (hostOf(url).endsWith('deepgram.com')) return deepgram(transcript);
    if (hostOf(url).endsWith('anthropic.com')) return claude(calls);
    if (hostOf(url).startsWith('generativelanguage.'))
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: calls.map((c) => ({ functionCall: { name: c.name, args: c.input } })),
              },
            },
          ],
        }),
      );
    if (hostOf(url).endsWith('openrouter.ai') || hostOf(url).endsWith('deepseek.com'))
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: calls.map((c) => ({
                  function: { name: c.name, arguments: JSON.stringify(c.input) },
                })),
              },
            },
          ],
        }),
      );
    throw new Error(`Unexpected provider URL: ${url}`);
  };
}
function table(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'is', 'order', 'limit', 'in', 'eq']) q[m] = () => q;
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
  return q;
}
function makeDeps(
  over: {
    fetchImpl?: FetchImpl;
    env?: Record<string, string>;
    enabled?: boolean;
    allowed?: boolean;
    allowlisted?: boolean;
    limits?: Partial<Limits>;
    now?: () => number;
  } = {},
) {
  const events: string[] = [];
  const rpc = vi.fn(async (name: string) => {
    events.push(name);
    if (name === 'waves_voice_agent_enabled') return { data: over.enabled ?? true, error: null };
    if (name === 'waves_voice_agent_quota')
      return {
        data: { used: 3, limit: 100, tier: 'pro', allowed: over.allowed ?? true },
        error: null,
      };
    return { data: 0, error: null };
  });
  const rows: Record<string, unknown[]> = {
    groups: fixtures.groups,
    group_members: fixtures.members,
    group_balances: fixtures.balances,
  };
  const from = vi.fn((name: string) => {
    events.push(`from:${name}`);
    return table(rows[name] ?? []);
  });
  const serviceFrom = vi.fn(() => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq']) q[m] = () => q;
    q.maybeSingle = async () => ({
      data: over.allowlisted ? { profile_id: fixtures.meProfileId } : null,
      error: null,
    });
    return q;
  });
  const fetchMock = vi.fn(over.fetchImpl ?? scriptedLlm([answer]));
  const rateLimit = vi.fn(async () => undefined);
  const deps = {
    caller: {
      auth: {
        getUser: async () => ({ data: { user: { id: fixtures.meProfileId } }, error: null }),
      },
      from,
    },
    service: { rpc, from: serviceFrom },
    env: (n: string) =>
      ({
        DEEPGRAM_API_KEY: 'dg',
        OPENROUTER_API_KEY: 'or',
        OPENROUTER_MODELS: 'test/one',
        GEMINI_API_KEY: 'ge',
        ...over.env,
      })[n],
    fetch: fetchMock,
    rateLimit,
    now: over.now ?? (() => 0),
    limits: over.limits,
  } as unknown as Deps;
  return { deps, rpc, from, serviceFrom, fetchMock, rateLimit, events };
}
const request = (extra: Record<string, unknown> = {}) =>
  new Request('https://x/voice-agent', {
    method: 'POST',
    body: JSON.stringify({
      schemaVersion: 1,
      transcript: 'at Blue Tokai',
      locale: 'en',
      today: fixtures.today,
      groupId: fixtures.currentGroupId,
      ...extra,
    }),
  });
const clip = (extra: Record<string, unknown> = {}) =>
  request({
    transcript: undefined,
    audioBase64: btoa('audio'),
    mimeType: 'audio/wav',
    durationMs: 1000,
    ...extra,
  });
const run = async (deps: Deps, extra: Record<string, unknown> = {}) =>
  (await handleVoiceAgent(request(extra), deps)).json();
const refunds = (rpc: ReturnType<typeof makeDeps>['rpc']) =>
  rpc.mock.calls.filter(([n]) => n === 'waves_voice_agent_refund');
const logs = () => vi.mocked(console.log).mock.calls.map(([line]) => JSON.parse(String(line)));
const payloads = (mock: ReturnType<typeof makeDeps>['fetchMock']) =>
  mock.mock.calls.map(([, init]) => JSON.parse(String(init.body)));
const unavailable = { status: 503, code: 'VOICE_AGENT_UNAVAILABLE' };
const hang: FetchImpl = (_url, init) =>
  new Promise((_, reject) =>
    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
  );
beforeEach(() => {
  breaker.reset();
  clearContextCache();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('follow-up handler integration', () => {
  it.skipIf(!WS2_LANDED)(
    'EH-01 saved personal follow-up carries context and preserves quota',
    async () => {
      const { deps, fetchMock, rpc } = makeDeps({ fetchImpl: scriptedLlm([update()]) });
      const body = await run(deps, { savedExpense: saved });
      expect(body.update).toEqual({ expenseId: saved.id, place: 'Blue Tokai' });
      expect(body.actions).toEqual([]);
      // D1: an unmetered follow-up reports no spend of the allowance.
      expect(body.quota.used).toBe(0);
      expect(rpc.mock.calls.some(([n]) => n === 'waves_voice_agent_quota')).toBe(false);
      const p = payloads(fetchMock)[0];
      expect(p.messages[0].content).toContain(
        `expenseId ${fixtureContext('followup:personal').saved!.id}`,
      );
      expect(p.messages[1].content).toBe('at Blue Tokai');
    },
  );
  it('EH-02 adding a personal expense in a follow-up is rejected; nothing was metered, so nothing is refunded', async () => {
    const { deps, rpc } = makeDeps({
      fetchImpl: scriptedLlm([
        {
          name: 'add_personal',
          input: { description: 'Coffee', amountMinor: '80000', currency: 'INR' },
        },
      ]),
    });
    const body = await run(deps, { savedExpense: saved });
    expect(body.actions).toEqual([]);
    expect(body.clarify).toBe(
      "Sorry, I didn't catch what to do with that. Could you say it again?",
    );
    expect(refunds(rpc)).toHaveLength(0);
    expect(rpc.mock.calls.some(([n]) => n === 'waves_voice_agent_quota')).toBe(false);
    expect(logs()[0].valid).toBe(false);
  });
  it('EH-03 cached context never retains the previous saved expense', async () => {
    let time = 0;
    const { deps, from, fetchMock } = makeDeps({
      now: () => time,
      fetchImpl: (url, init) => {
        const id = String(init.body).includes('exp-second') ? 'exp-second' : saved.id;
        return scriptedLlm([update(id)])(url, init);
      },
    });
    expect((await run(deps, { savedExpense: saved })).update.expenseId).toBe(saved.id);
    time = 1000;
    expect(
      (await run(deps, { savedExpense: { ...saved, id: 'exp-second' } })).update.expenseId,
    ).toBe('exp-second');
    expect(from).toHaveBeenCalledTimes(3);
    expect(payloads(fetchMock)[1].messages[0].content).not.toContain(`expenseId ${saved.id}`);
  });
  it('EH-04 provider timeout escalates to a valid update and records one failure', async () => {
    const { deps } = makeDeps({
      limits: { llmAttemptMs: 25, minAttemptMs: 5 },
      fetchImpl: (url, init) =>
        hostOf(url).endsWith('openrouter.ai')
          ? hang(url, init)
          : scriptedLlm([update()])(url, init),
    });
    expect((await run(deps, { savedExpense: saved })).update.place).toBe('Blue Tokai');
    expect(logs()[0]).toMatchObject({ escalated: true, failures: ['openrouter:timeout'] });
    breaker.failure('openrouter');
    expect(breaker.isOpen('openrouter')).toBe(false);
    breaker.failure('openrouter');
    expect(breaker.isOpen('openrouter')).toBe(true);
  });
  it('EH-05 all providers down: 503, refund once, each model attempted once', async () => {
    const { deps, rpc, fetchMock } = makeDeps({
      fetchImpl: () => new Response('down', { status: 503 }),
    });
    await expect(run(deps)).rejects.toMatchObject(unavailable);
    expect(refunds(rpc)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const attempts = fetchMock.mock.calls.map(
      ([url, init]) => `${url}|${JSON.parse(String(init.body)).model ?? url}`,
    );
    expect(new Set(attempts).size).toBe(3);
    expect(console.error).toHaveBeenCalled();
  });
  it('EH-06 insufficient remaining budget prevents a second attempt', async () => {
    let time = 0;
    const { deps, rpc, fetchMock } = makeDeps({
      now: () => time,
      limits: { totalMs: 100, minAttemptMs: 50 },
      fetchImpl: () => {
        time = 80;
        return new Response('down', { status: 503 });
      },
    });
    await expect(run(deps)).rejects.toMatchObject(unavailable);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refunds(rpc)).toHaveLength(1);
    expect(vi.mocked(console.error).mock.calls.some(([s]) => String(s).includes('"budget"'))).toBe(
      true,
    );
  });
  it('EH-07 denied quota stops LLM and starts no context reads after quota', async () => {
    // Context reads intentionally run alongside reservation on a cold request.
    // With a warm context, a denied turn must perform no additional reads.
    await run(makeDeps().deps);
    const { deps, events, from, fetchMock, rpc } = makeDeps({ allowed: false });
    await expect(run(deps)).rejects.toMatchObject({ status: 402, code: 'VOICE_AGENT_QUOTA' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(refunds(rpc)).toHaveLength(0);
    expect(
      events
        .slice(events.indexOf('waves_voice_agent_quota') + 1)
        .filter((e) => e.startsWith('from:')),
    ).toEqual([]);
  });
  it('EH-08 flag off fails before rate limiting', async () => {
    const { deps, rateLimit, rpc } = makeDeps({ enabled: false });
    await expect(run(deps)).rejects.toMatchObject(unavailable);
    expect(rateLimit).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('EH-09 rate limit rejection propagates before reservation', async () => {
    const { deps, rateLimit, rpc, fetchMock } = makeDeps();
    rateLimit.mockRejectedValueOnce(new HttpError(429, 'RATE_LIMITED', 'Slow down'));
    await expect(run(deps)).rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('EH-10 saved expense with meterOnly still avoids LLM and context', async () => {
    const { deps, fetchMock, from } = makeDeps();
    const body = await run(deps, { meterOnly: true, savedExpense: saved });
    expect(body.actions).toEqual([]);
    expect(body.quota.used).toBe(3);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
  it('EH-11 transcript over 2000 characters is malformed', async () => {
    const { deps, rpc } = makeDeps();
    await expect(run(deps, { transcript: 'a'.repeat(2001) })).rejects.toMatchObject({
      status: 400,
      code: 'BAD_REQUEST',
    });
    expect(rpc).not.toHaveBeenCalled();
  });
  it('EH-12 transcript takes precedence over supplied audio', async () => {
    const { deps, fetchMock } = makeDeps();
    const body = await (await handleVoiceAgent(clip({ transcript: 'typed command' }), deps)).json();
    expect(body.transcript).toBe('typed command');
    expect(fetchMock.mock.calls.some(([u]) => u.includes('deepgram'))).toBe(false);
  });
  it('EH-13 Anthropic logs cache usage and computed cost without names or transcript', async () => {
    const { deps } = makeDeps({
      env: { VOICE_LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'an' },
      fetchImpl: () =>
        claude([answer], {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 200,
          cache_creation_input_tokens: 80,
        }),
    });
    await run(deps, { transcript: 'Madan at Blue Tokai with Anu' });
    expect(logs()[0].anthropic).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 200,
      cacheWriteTokens: 80,
      costUsd: 0.00032,
    });
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toMatch(
      /Madan|Blue Tokai|Anu|transcript/,
    );
  });
  it.skipIf(!WS2_LANDED)(
    'EH-14 clarify followUp and savedExpense together are rejected',
    async () => {
      const { deps, rpc, fetchMock } = makeDeps();
      await expect(
        run(deps, { savedExpense: saved, followUp: { transcript: 'coffee', question: 'Where?' } }),
      ).rejects.toMatchObject({ status: 400, code: 'BAD_REQUEST' });
      expect(rpc).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it('EH-15 empty Deepgram transcript returns 422 and refunds', async () => {
    const { deps, rpc, fetchMock } = makeDeps({ fetchImpl: scriptedLlm([answer], '') });
    await expect(handleVoiceAgent(clip(), deps)).rejects.toMatchObject({
      status: 422,
      code: 'VOICE_AGENT_NOTHING_HEARD',
    });
    expect(refunds(rpc)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('EH-16 clarification keeps three options and omits a singleton', async () => {
    for (const count of [3, 1]) {
      const options = ['Goa trip', 'Flat 4B', 'London']
        .slice(0, count)
        .map((label) => ({ label, answer: label }));
      const { deps } = makeDeps({
        fetchImpl: scriptedLlm([
          { name: 'ask_clarification', input: { question: 'Which group?', options } },
        ]),
      });
      const body = await run(deps);
      expect(body.clarify).toBe('Which group?');
      if (count === 3) expect(body.clarifyOptions).toEqual(options);
      else expect(body).not.toHaveProperty('clarifyOptions');
    }
  });
  it('EH-17 chaos requires allowlist match and records active flags in metadata', async () => {
    const env = { VOICE_CHAOS_ENABLED: '1', VOICE_CHAOS: 'deepgram-down' };
    const off = makeDeps({ env });
    await run(off.deps);
    expect(off.serviceFrom).toHaveBeenCalledWith('voice_agent_allowlist');
    expect(logs().at(-1)).not.toHaveProperty('chaos');
    const on = makeDeps({ env, allowlisted: true });
    await run(on.deps);
    expect(logs().at(-1).chaos).toEqual(['deepgram-down']);
    await expect(handleVoiceAgent(clip(), on.deps)).rejects.toMatchObject(unavailable);
    expect(refunds(on.rpc)).toHaveLength(1);
    expect(off.fetchMock).toHaveBeenCalledTimes(1);
  });
  it('EH-18 update and answer both pass through', async () => {
    const { deps } = makeDeps({ fetchImpl: scriptedLlm([update(), answer]) });
    const body = await run(deps, { savedExpense: saved });
    expect(body.update).toEqual(update().input);
    expect(body.answer).toBe('Done.');
    expect(body.actions).toEqual([]);
  });
  it.skipIf(!WS2_LANDED)(
    'EH-19 delete proposes the saved id without writing an expense',
    async () => {
      const { deps, rpc, from, serviceFrom } = makeDeps({
        fetchImpl: scriptedLlm([{ name: 'delete_expense', input: { expenseId: 'eh19-delete' } }]),
      });
      const body = await run(deps, { savedExpense: { ...saved, id: 'eh19-delete' } });
      expect(body.delete).toEqual({ expenseId: 'eh19-delete' });
      expect(body.actions).toEqual([]);
      expect(from.mock.calls.map(([t]) => t)).toEqual([
        'groups',
        'group_members',
        'group_balances',
      ]);
      expect(serviceFrom).not.toHaveBeenCalled();
      expect(rpc.mock.calls.every(([n]) => n.startsWith('waves_voice_agent_'))).toBe(true);
    },
  );
  it.skipIf(!WS2_LANDED)(
    'EH-20 saved group context excludes other groups and their members',
    async () => {
      const { deps, fetchMock } = makeDeps({ fetchImpl: scriptedLlm([answer]) });
      await run(deps, { savedExpense: { ...fixtures.saved.group, id: 'eh20-group' } });
      const context = payloads(fetchMock)[0].messages[0].content.split('Context:\n').at(-1);
      expect(context).toContain('GROUP g-goa');
      expect(context).toContain('m-anu');
      expect(context).not.toMatch(/GROUP g-home|GROUP g-london|m-sam|m-priya/);
    },
  );
  it.skipIf(!WS2_LANDED)(
    'EH-21 fourth follow-up for an expense within ten minutes hits cap',
    async () => {
      const { deps, fetchMock } = makeDeps();
      const extra = { savedExpense: { ...saved, id: 'eh21-cap' } };
      for (let i = 0; i < 3; i++) expect((await run(deps, extra)).answer).toBe('Done.');
      await expect(run(deps, extra)).rejects.toMatchObject({
        status: 429,
        code: 'VOICE_AGENT_FOLLOWUP_CAP',
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect((await run(deps, { savedExpense: { ...saved, id: 'eh21-other' } })).answer).toBe(
        'Done.',
      );
    },
  );
  it('EH-22 OpenRouter reasoning rejection retries once without reasoning', async () => {
    let n = 0;
    const { deps, fetchMock, rpc } = makeDeps({
      fetchImpl: (url, init) =>
        ++n === 1
          ? new Response('reasoning unsupported', { status: 400 })
          : scriptedLlm([answer])(url, init),
    });
    expect((await run(deps)).answer).toBe('Done.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([u]) => u.includes('openrouter'))).toBe(true);
    const p = payloads(fetchMock);
    expect(p[0].reasoning).toEqual({ effort: 'low' });
    expect(p[1]).not.toHaveProperty('reasoning');
    expect(refunds(rpc)).toHaveLength(0);
  });
  it('EH-23 invalid DeepSeek JSON is rejected and native Gemini tools recover', async () => {
    const { deps, fetchMock } = makeDeps({
      env: { VOICE_LLM_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'ds', OPENROUTER_API_KEY: '' },
      fetchImpl: (url, init) =>
        hostOf(url).endsWith('deepseek.com')
          ? new Response(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      tool_calls: [{ function: { name: 'add_personal', arguments: '{bad' } }],
                    },
                  },
                ],
              }),
            )
          : scriptedLlm([answer])(url, init),
    });
    const body = await run(deps);
    expect(body.answer).toBe('Done.');
    expect(body.actions).toEqual([]);
    expect(fetchMock.mock.calls.filter(([u]) => u.includes('deepseek'))).toHaveLength(2);
    expect(fetchMock.mock.calls.at(-1)![0]).toContain('generativelanguage');
    expect(logs()[0].escalated).toBe(true);
  });
  it('EH-24 non-JSON 200 counts toward breaker failure', async () => {
    const { deps } = makeDeps({
      fetchImpl: (url, init) =>
        hostOf(url).endsWith('openrouter.ai')
          ? new Response('<html>bad</html>')
          : scriptedLlm([answer])(url, init),
    });
    expect((await run(deps)).answer).toBe('Done.');
    expect(logs()[0].failures).toEqual(['openrouter']);
    breaker.failure('openrouter');
    expect(breaker.isOpen('openrouter')).toBe(false);
    breaker.failure('openrouter');
    expect(breaker.isOpen('openrouter')).toBe(true);
  });
  it('EH-25 open OpenRouter breaker starts directly at Gemini', async () => {
    for (let i = 0; i < 3; i++) breaker.failure('openrouter');
    const { deps, fetchMock } = makeDeps();
    expect((await run(deps)).answer).toBe('Done.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('generativelanguage');
  });
  it('EH-26 malformed today is rejected before RPC or provider calls', async () => {
    const { deps, rpc, fetchMock } = makeDeps();
    await expect(run(deps, { today: '21/10/2026' })).rejects.toMatchObject({
      status: 400,
      code: 'BAD_REQUEST',
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('EH-27 Deepgram query language follows Tamil Hindi and British English policy', async () => {
    for (const [locale, language] of [
      ['ta', 'multi'],
      ['hi', 'hi'],
      ['en-GB', 'en-IN'],
    ]) {
      const { deps, fetchMock } = makeDeps();
      await handleVoiceAgent(clip({ locale }), deps);
      const dg = fetchMock.mock.calls.find(([u]) => u.includes('deepgram'))!;
      expect(new URL(dg[0]).searchParams.get('language')).toBe(language);
    }
  });
  it('EH-28 response uses schemaVersion one and ignores unknown request fields', async () => {
    const { deps } = makeDeps();
    const body = await run(deps, { unknownFutureField: { arbitrary: true } });
    expect(body.schemaVersion).toBe(1);
    expect(body.answer).toBe('Done.');
    expect(body).not.toHaveProperty('unknownFutureField');
  });
});

function hostOf(url: string): string {
  return new URL(url).hostname;
}
