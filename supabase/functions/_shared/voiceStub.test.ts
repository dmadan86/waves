import { describe, expect, it, vi } from 'vitest';

import {
  cannedCalls,
  PROD_PROJECT_REF,
  stubDecision,
  stubFetch,
  withVoiceStub,
} from './voiceStub.ts';
import { contextText, parseToolCalls } from '../voice-agent/logic.ts';
import { fixtureContext } from '../voice-agent/evals/harness.ts';

const envOf =
  (vars: Record<string, string | undefined>) =>
  (name: string): string | undefined =>
    vars[name];

const STAGING = 'https://emyjuhazbynzwjqcfloh.supabase.co';
const PROD = `https://${PROD_PROJECT_REF}.supabase.co`;

describe('VOICE_AGENT_STUB gate', () => {
  it('is off unless VOICE_AGENT_STUB is exactly 1', () => {
    for (const value of [undefined, '', '0', 'true', 'yes', ' 1']) {
      expect(stubDecision(envOf({ VOICE_AGENT_STUB: value, SUPABASE_URL: STAGING }))).toEqual({
        active: false,
        reason: 'off',
      });
    }
  });

  it('activates on the staging project', () => {
    expect(stubDecision(envOf({ VOICE_AGENT_STUB: '1', SUPABASE_URL: STAGING }))).toEqual({
      active: true,
      ref: 'emyjuhazbynzwjqcfloh',
    });
  });

  it('activates on a local stack', () => {
    for (const url of ['http://127.0.0.1:54321', 'http://localhost:54321', 'http://kong:8000']) {
      expect(stubDecision(envOf({ VOICE_AGENT_STUB: '1', SUPABASE_URL: url }))).toEqual({
        active: true,
        ref: 'local',
      });
    }
  });

  it('REFUSES on the production project ref (SUPABASE_URL)', () => {
    expect(stubDecision(envOf({ VOICE_AGENT_STUB: '1', SUPABASE_URL: PROD }))).toEqual({
      active: false,
      reason: 'production',
    });
  });

  it('REFUSES on the production ref named by SUPABASE_PROJECT_REF, whatever the URL says', () => {
    expect(
      stubDecision(
        envOf({
          VOICE_AGENT_STUB: '1',
          SUPABASE_URL: STAGING,
          SUPABASE_PROJECT_REF: PROD_PROJECT_REF,
        }),
      ),
    ).toEqual({ active: false, reason: 'production' });
    expect(
      stubDecision(envOf({ VOICE_AGENT_STUB: '1', SUPABASE_PROJECT_REF: PROD_PROJECT_REF })),
    ).toEqual({ active: false, reason: 'production' });
  });

  it('REFUSES behind a custom domain or proxy that carries the production ref', () => {
    expect(
      stubDecision(
        envOf({ VOICE_AGENT_STUB: '1', SUPABASE_URL: `https://${PROD_PROJECT_REF}.example.com` }),
      ),
    ).toEqual({ active: false, reason: 'production' });
    expect(
      stubDecision(
        envOf({
          VOICE_AGENT_STUB: '1',
          SUPABASE_URL: `https://proxy.example.com/${PROD_PROJECT_REF.toUpperCase()}`,
        }),
      ),
    ).toEqual({ active: false, reason: 'production' });
  });

  it('REFUSES when the project cannot be identified (fails closed)', () => {
    expect(stubDecision(envOf({ VOICE_AGENT_STUB: '1' }))).toEqual({
      active: false,
      reason: 'unknown_project',
    });
    expect(stubDecision(envOf({ VOICE_AGENT_STUB: '1', SUPABASE_URL: 'not a url' }))).toEqual({
      active: false,
      reason: 'unknown_project',
    });
  });

  it('on a refusal leaves env and fetch untouched and logs the reason, never a transcript', () => {
    const env = envOf({ VOICE_AGENT_STUB: '1', SUPABASE_URL: PROD });
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const out = withVoiceStub(env, fetchFn);
    expect(out.active).toBe(false);
    expect(out.env).toBe(env);
    expect(out.fetch).toBe(fetchFn);
    expect(out.env('OPENROUTER_API_KEY')).toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain('voice_stub_refused');
    expect(String(error.mock.calls[0]?.[0])).toContain('production');
    error.mockRestore();
  });

  it('stays silent and untouched when the switch is off', () => {
    const env = envOf({ SUPABASE_URL: PROD });
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const out = withVoiceStub(env, fetchFn);
    expect(out).toMatchObject({ active: false, env, fetch: fetchFn });
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('on staging supplies a placeholder provider key and never reaches the network for an LLM', async () => {
    const real = vi.fn(async () => new Response('real')) as unknown as typeof fetch;
    const out = withVoiceStub(envOf({ VOICE_AGENT_STUB: '1', SUPABASE_URL: STAGING }), real);
    expect(out.active).toBe(true);
    expect(out.env('OPENROUTER_API_KEY')).toBe('stub-key');
    await out.fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
    });
    expect(real).not.toHaveBeenCalled();
    await out.fetch('https://example.com/other');
    expect(real).toHaveBeenCalledTimes(1);
  });
});

describe('canned tool calls', () => {
  // The fixture context: Goa trip (Madan, Anu, Ravi), Flat 4B (Madan, Sam).
  const context = (name?: Parameters<typeof fixtureContext>[0]) =>
    `Context:\n${contextText(fixtureContext(name))}`;
  const run = (sentence: string, ctx = context()) => {
    const calls = cannedCalls(ctx, sentence);
    return { calls, parsed: parseToolCalls(calls, fixtureContext()) };
  };

  it('personal add reads "add 8000 rupees to my personal expense" and validates', () => {
    const { calls, parsed } = run('add 8000 rupees to my personal expense');
    expect(calls).toEqual([
      {
        name: 'add_personal',
        input: {
          description: 'Personal expense',
          amountMinor: '800000',
          currency: 'INR',
          category: 'shopping',
        },
      },
    ]);
    expect(parsed.ok).toBe(true);
  });

  it('group add names the payer in the description but pays as me, and validates', () => {
    const { calls, parsed } = run('dinner 1200 Ravi paid, Goa trip');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toMatchObject({
      groupId: 'g-goa',
      description: 'Dinner Ravi paid',
      amountMinor: '120000',
      paidByMemberId: 'm-me',
    });
    expect(parsed.ok).toBe(true);
  });

  it('asks which group, with a chip per group, when none is named', () => {
    const { calls, parsed } = run('add 8000 to');
    expect(calls[0]?.name).toBe('ask_clarification');
    const options = (calls[0]?.input as { options: { label: string; answer: string }[] }).options;
    expect(options.map((o) => o.label)).toEqual(expect.arrayContaining(['Goa trip', 'Flat 4B']));
    expect(parsed.ok).toBe(true);
    // The chip's answer arrives as the last line, after the earlier command.
    const second = run(
      `Earlier command: add 8000 to\nYou asked: Which group is this for?\nTheir answer:\n${options.find((o) => o.label === 'Goa trip')?.answer}`,
    );
    expect(second.calls[0]?.name).toBe('add_expense');
    expect(second.calls[0]?.input).toMatchObject({ groupId: 'g-goa', amountMinor: '800000' });
  });

  it('answers "who owes me" from the balances in the context', () => {
    const { calls } = run('who owes me');
    expect(calls[0]?.name).toBe('answer_question');
    const text = (calls[0]?.input as { text: string }).text;
    expect(text).toContain('Anu owes you ₹1,250');
    expect(text).toContain('Ravi owes you ₹500');
  });

  it('turns a follow-up reply into update_expense for the saved expense only', () => {
    const ctx = context('followup:personal');
    const { calls } = run('blue tokai, cash', ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('update_expense');
    expect(calls[0]?.input).toMatchObject({ place: 'blue tokai', paymentMethod: 'cash' });
    const parsed = parseToolCalls(calls, fixtureContext('followup:personal'));
    expect(parsed.ok).toBe(true);
  });

  it('splits two items in one breath into two group expenses', () => {
    const { calls } = run('breakfast 300 and cab 450 Goa');
    expect(calls.map((c) => c.name)).toEqual(['add_expense', 'add_expense']);
    expect(calls.map((c) => (c.input as { amountMinor: string }).amountMinor)).toEqual([
      '30000',
      '45000',
    ]);
  });

  it('asks to repeat when there is no amount', () => {
    expect(run('hello there').calls[0]?.name).toBe('ask_clarification');
  });

  it('is deterministic', () => {
    expect(run('dinner 1200 Goa').calls).toEqual(run('dinner 1200 Goa').calls);
  });

  it('answers in each provider wire format with the same calls', async () => {
    const ctx = context();
    const expected = cannedCalls(ctx, 'dinner 1200 Goa');
    const f = stubFetch(vi.fn() as unknown as typeof fetch);
    const or = await (
      await f('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          messages: [
            { role: 'system', content: ctx },
            { role: 'user', content: 'dinner 1200 Goa' },
          ],
        }),
      })
    ).json();
    expect(JSON.parse(or.choices[0].message.tool_calls[0].function.arguments)).toEqual(
      expected[0]?.input,
    );
    const gem = await (
      await f('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent', {
        method: 'POST',
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'dinner 1200 Goa' }] }],
          systemInstruction: { parts: [{ text: ctx }] },
        }),
      })
    ).json();
    expect(gem.candidates[0].content.parts[0].functionCall.args).toEqual(expected[0]?.input);
    const an = await (
      await f('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        body: JSON.stringify({
          system: [
            { type: 'text', text: 'rules' },
            { type: 'text', text: ctx },
          ],
          messages: [{ role: 'user', content: 'dinner 1200 Goa' }],
        }),
      })
    ).json();
    expect(an.content[0]).toMatchObject({ type: 'tool_use', input: expected[0]?.input });
  });
});
