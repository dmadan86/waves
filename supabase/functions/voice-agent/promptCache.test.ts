/**
 * Anthropic prompt caching in voice-agent: where the breakpoints sit, that
 * nothing per-request lands before them, that the other providers' requests are
 * untouched, and that cache tokens are priced (0.1x read, 1.25x write).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { breaker, clearContextCache, handleVoiceAgent, type Deps } from './handler.ts';
import {
  anthropicCostUsd,
  ANTHROPIC_TOOLS,
  anthropicSystem,
  STATIC_SYSTEM_PROMPT,
  systemPrompt,
  TOOLS,
} from './logic.ts';

const ME = 'profile-me';

beforeEach(() => {
  clearContextCache();
  breaker.reset();
});

function table(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'is', 'order', 'limit', 'in']) q[m] = () => q;
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
  return q;
}

const tables: Record<string, unknown[]> = {
  groups: [{ id: 'g1', name: 'Goa Trip', type: 'trip', default_currency: 'INR' }],
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

const goodExpense = {
  groupId: 'g1',
  description: 'Dinner',
  amountMinor: '120000',
  currency: 'INR',
  paidByMemberId: 'm-me',
  split: { mode: 'equal', shares: [{ memberId: 'm-me' }, { memberId: 'm-anu' }] },
};

function run(env: Record<string, string>, usage?: Record<string, number>) {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes('deepgram')) return new Response('{}');
    if (String(url).includes('anthropic')) {
      return new Response(
        JSON.stringify({
          content: [{ type: 'tool_use', id: 't', name: 'add_expense', input: goodExpense }],
          ...(usage ? { usage } : {}),
        }),
      );
    }
    // deepseek / openrouter / gemini all fail validation harmlessly
    return new Response(JSON.stringify({}));
  });
  const deps: Deps = {
    env: (n) => ({ ...env })[n],
    caller: {
      auth: { getUser: async () => ({ data: { user: { id: ME } }, error: null }) },
      from: (t: string) => table(tables[t] ?? []),
    },
    service: {
      rpc: vi.fn(async (name: string) =>
        name === 'waves_voice_agent_enabled'
          ? { data: true, error: null }
          : name === 'waves_voice_agent_quota'
            ? { data: { used: 1, limit: 10, tier: 'free', allowed: true }, error: null }
            : { data: 0, error: null },
      ),
    },
    fetch: fetchMock as unknown as typeof fetch,
    now: () => 0,
    rateLimit: async () => undefined,
  } as unknown as Deps;
  const request = new Request('https://x/voice-agent', {
    method: 'POST',
    body: JSON.stringify({
      schemaVersion: 1,
      transcript: 'dinner 1200 with Anu',
      locale: 'en',
      today: '2026-10-15',
      groupId: 'g1',
    }),
  });
  return { deps, fetchMock, request };
}

const anthropicBody = (fetchMock: ReturnType<typeof vi.fn>) => {
  const call = fetchMock.mock.calls.find(([url]) => String(url).includes('anthropic'));
  return JSON.parse((call![1] as RequestInit).body as string);
};

describe('Anthropic request cache breakpoints', () => {
  it('puts cache_control on the last tool only and on the static system block only', async () => {
    const { deps, fetchMock, request } = run({
      ANTHROPIC_API_KEY: 'an',
      VOICE_LLM_PROVIDER: 'anthropic',
    });
    await handleVoiceAgent(request, deps);
    const body = anthropicBody(fetchMock);

    expect(body.tools).toHaveLength(TOOLS.length);
    body.tools.forEach((tool: Record<string, unknown>, i: number) => {
      if (i === body.tools.length - 1) expect(tool.cache_control).toEqual({ type: 'ephemeral' });
      else expect(tool.cache_control).toBeUndefined();
    });

    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system).toHaveLength(2);
    expect(body.system[0].text).toBe(STATIC_SYSTEM_PROMPT);
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.system[1].cache_control).toBeUndefined();
    // Never more than the four breakpoints the API allows.
    expect(JSON.stringify(body).match(/cache_control/g)).toHaveLength(2);
  });

  it('keeps everything per-request after the breakpoint', async () => {
    const { deps, fetchMock, request } = run({
      ANTHROPIC_API_KEY: 'an',
      VOICE_LLM_PROVIDER: 'anthropic',
    });
    await handleVoiceAgent(request, deps);
    const body = anthropicBody(fetchMock);
    const cached = JSON.stringify(body.tools) + body.system[0].text;
    for (const dynamic of ['2026-10-15', 'Goa Trip', 'Anu', 'm-anu', 'g1', 'INR']) {
      expect(cached).not.toContain(dynamic);
    }
    expect(body.system[1].text).toContain('Today: 2026-10-15');
    expect(body.system[1].text).toContain('Goa Trip');
    expect(body.messages).toEqual([{ role: 'user', content: 'dinner 1200 with Anu' }]);
  });

  it('keeps the cached prefix byte-identical across different people and days', () => {
    const a = anthropicSystem({ groups: [], currentGroupId: null, today: '2026-10-15' });
    const b = anthropicSystem({
      groups: [
        {
          id: 'x',
          name: 'Other',
          currency: 'USD',
          type: 'home',
          members: [{ id: 'y', name: 'Zed', me: true }],
          balances: {},
        },
      ],
      currentGroupId: 'x',
      today: '2027-01-01',
    });
    expect(a[0]).toEqual(b[0]);
    expect(a[1]!.text).not.toEqual(b[1]!.text);
  });

  it('does not change the text other providers receive', () => {
    const context = { groups: [], currentGroupId: null, today: '2026-10-15' };
    const text = systemPrompt(context);
    expect(text.startsWith(STATIC_SYSTEM_PROMPT + '\n\nContext:\n')).toBe(true);
    expect(text.endsWith('Today: 2026-10-15\nThe caller is in no groups yet.')).toBe(true);
    expect(JSON.stringify(ANTHROPIC_TOOLS.slice(0, -1))).toBe(JSON.stringify(TOOLS.slice(0, -1)));
  });

  it('adds no cache_control to the OpenRouter request', async () => {
    const { deps, fetchMock, request } = run({
      OPENROUTER_API_KEY: 'or',
      VOICE_LLM_PROVIDER: 'openrouter',
    });
    await handleVoiceAgent(request, deps).catch(() => undefined);
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('openrouter'));
    expect(call).toBeDefined();
    expect((call![1] as RequestInit).body as string).not.toContain('cache_control');
  });
});

describe('cache token pricing', () => {
  it('prices reads at 0.1x and writes at 1.25x the input rate (Haiku 4.5: $1/$5)', () => {
    const haiku = 'claude-haiku-4-5-20251001';
    expect(anthropicCostUsd(haiku, { input_tokens: 1_000_000 })).toBeCloseTo(1);
    expect(anthropicCostUsd(haiku, { cache_read_input_tokens: 1_000_000 })).toBeCloseTo(0.1);
    expect(anthropicCostUsd(haiku, { cache_creation_input_tokens: 1_000_000 })).toBeCloseTo(1.25);
    expect(anthropicCostUsd(haiku, { output_tokens: 1_000_000 })).toBeCloseTo(5);
    expect(
      anthropicCostUsd(haiku, {
        input_tokens: 200,
        cache_read_input_tokens: 5000,
        cache_creation_input_tokens: 0,
        output_tokens: 100,
      }),
    ).toBeCloseTo((200 * 1 + 5000 * 0.1 + 100 * 5) / 1e6);
  });

  it('knows Sonnet 5.5 ($2/$10) and returns null for an unknown model', () => {
    expect(
      anthropicCostUsd('claude-sonnet-5-5', { cache_read_input_tokens: 1_000_000 }),
    ).toBeCloseTo(0.2);
    expect(anthropicCostUsd('mystery', { input_tokens: 5 })).toBeNull();
  });

  it('logs cache tokens and cost in the structured line', async () => {
    const { deps, request } = run(
      { ANTHROPIC_API_KEY: 'an', VOICE_LLM_PROVIDER: 'anthropic' },
      {
        input_tokens: 300,
        output_tokens: 80,
        cache_read_input_tokens: 4000,
        cache_creation_input_tokens: 0,
      },
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await handleVoiceAgent(request, deps);
    const line = JSON.parse(String(log.mock.calls.at(-1)![0]));
    log.mockRestore();
    expect(line.anthropic).toEqual({
      inputTokens: 300,
      outputTokens: 80,
      cacheReadTokens: 4000,
      cacheWriteTokens: 0,
      costUsd: Number(((300 + 400 + 400) / 1e6).toFixed(6)),
    });
  });
});
