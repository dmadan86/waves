/**
 * The stream-token gate: flag first, then the key, then a minted Deepgram token
 * and the live URL carrying the caller's names as keyterms.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearContextCache } from '../voice-agent/handler.ts';
import { handleVoiceStreamToken, type Deps } from './handler.ts';

const ME = 'profile-me';

beforeEach(() => clearContextCache());

function table(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  for (const m of ['select', 'is', 'order', 'limit', 'in']) q[m] = chain;
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
  return q;
}

function makeDeps(over: {
  enabled?: boolean;
  env?: Record<string, string>;
  grant?: Response;
  used?: number;
  pro?: boolean;
  plus?: boolean;
  trial?: boolean;
  trialUsed?: number;
  /** Days since the trial was granted; Pro lasts 15, the voice pool 30. */
  trialAgeDays?: number;
  mints?: number;
  mintError?: boolean;
}) {
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
      { id: 'm-renny', group_id: 'g1', profile_id: null, ghost_name: 'Renny', profile: null },
    ],
    group_balances: [],
  };
  const fetchMock = vi.fn(
    async () =>
      over.grant ?? new Response(JSON.stringify({ access_token: 'tmp-token', expires_in: 60 })),
  );
  const deps: Deps = {
    env: (n) => ({ DEEPGRAM_API_KEY: 'dg', ...over.env })[n],
    caller: {
      auth: { getUser: async () => ({ data: { user: { id: ME } }, error: null }) },
      from: (t: string) => table(tables[t] ?? []),
    } as never,
    service: {
      rpc: async (name: string, args: Record<string, number>) => {
        if (name !== 'waves_voice_stream_mint') return { data: over.enabled ?? true, error: null };
        if (over.mintError) return { data: null, error: { message: 'down' } };
        const budget = over.trial
          ? args.p_trial_budget
          : over.pro
            ? args.p_pro_budget
            : over.plus
              ? args.p_plus_budget
              : args.p_free_budget;
        const used = over.mints ?? 0;
        return {
          data: {
            allowed: used < budget,
            mints: Math.min(used + 1, budget),
            budget,
            tier: over.pro || over.trial ? 'pro' : over.plus ? 'plus' : 'free',
          },
          error: null,
        };
      },
      from: (t: string) => {
        const rows =
          t === 'subscriptions'
            ? over.trial
              ? [
                  {
                    tier: 'pro',
                    store: 'trial',
                    status: 'active',
                    current_period_end: '2999-01-01',
                  },
                ]
              : over.pro || over.plus
                ? [{ tier: over.pro ? 'pro' : 'plus', status: 'active', current_period_end: null }]
                : []
            : [];
        const q: Record<string, unknown> = {};
        const chain = () => q;
        for (const m of ['select', 'eq']) q[m] = chain;
        q.maybeSingle = async () => ({
          data:
            t === 'voice_agent_usage'
              ? { count: over.used ?? 0 }
              : t === 'pro_trials'
                ? over.trial
                  ? {
                      voice_used: over.trialUsed ?? 0,
                      outcome: 'granted',
                      granted_at: new Date(
                        Date.now() - (over.trialAgeDays ?? 0) * 86_400_000,
                      ).toISOString(),
                    }
                  : null
                : null,
          error: null,
        });
        q.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
        return q;
      },
    } as never,
    fetch: fetchMock as unknown as typeof fetch,
    rateLimit: async () => undefined,
  };
  return { deps, fetchMock };
}

const request = () =>
  new Request('https://x/voice-stream-token', {
    method: 'POST',
    body: JSON.stringify({ locale: 'en', groupId: 'g1' }),
  });

describe('handleVoiceStreamToken', () => {
  it('503s when the feature is off, before minting anything', async () => {
    const { deps, fetchMock } = makeDeps({ enabled: false });
    await expect(handleVoiceStreamToken(request(), deps)).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('402s once the month is spent, before minting anything (free and Pro limits)', async () => {
    const free = makeDeps({ used: 10 });
    await expect(handleVoiceStreamToken(request(), free.deps)).rejects.toMatchObject({
      status: 402,
      code: 'VOICE_AGENT_QUOTA',
    });
    expect(free.fetchMock).not.toHaveBeenCalled();
    const pro = makeDeps({ used: 10, pro: true });
    await expect(handleVoiceStreamToken(request(), pro.deps)).resolves.toBeTruthy();
  });

  it('gives Plus 50 commands and 150 streams a month, Pro 150 and 450', async () => {
    const plusSpent = makeDeps({ used: 50, plus: true });
    await expect(handleVoiceStreamToken(request(), plusSpent.deps)).rejects.toMatchObject({
      status: 402,
      code: 'VOICE_AGENT_QUOTA',
    });
    await expect(
      handleVoiceStreamToken(request(), makeDeps({ used: 49, plus: true }).deps),
    ).resolves.toBeTruthy();
    // 50 commands is Plus's limit, but well inside Pro's.
    await expect(
      handleVoiceStreamToken(request(), makeDeps({ used: 50, pro: true }).deps),
    ).resolves.toBeTruthy();
    await expect(
      handleVoiceStreamToken(request(), makeDeps({ mints: 149, plus: true }).deps),
    ).resolves.toBeTruthy();
    await expect(
      handleVoiceStreamToken(request(), makeDeps({ mints: 150, plus: true }).deps),
    ).rejects.toMatchObject({ code: 'VOICE_STREAM_BUDGET' });
  });

  it('on the Pro trial the stream gate allows 20 commands in total and a 60-stream budget', async () => {
    await expect(
      handleVoiceStreamToken(request(), makeDeps({ trial: true, trialUsed: 19 }).deps),
    ).resolves.toBeTruthy();
    await expect(
      handleVoiceStreamToken(request(), makeDeps({ trial: true, trialUsed: 20 }).deps),
    ).rejects.toMatchObject({ status: 402, code: 'VOICE_AGENT_QUOTA' });
    await expect(
      handleVoiceStreamToken(request(), makeDeps({ trial: true, mints: 60 }).deps),
    ).rejects.toMatchObject({ code: 'VOICE_STREAM_BUDGET' });
  });

  it('keeps the trial pool usable after the Pro days end, until day 30', async () => {
    await expect(
      handleVoiceStreamToken(
        request(),
        makeDeps({ trial: true, trialAgeDays: 20, trialUsed: 5 }).deps,
      ),
    ).resolves.toBeTruthy();
    await expect(
      handleVoiceStreamToken(
        request(),
        makeDeps({ trial: true, trialAgeDays: 20, trialUsed: 20 }).deps,
      ),
    ).rejects.toMatchObject({ code: 'VOICE_AGENT_QUOTA' });
    // Day 31: the pool is gone and the normal free allowance (10 a month) applies.
    await expect(
      handleVoiceStreamToken(
        request(),
        makeDeps({ trial: true, trialAgeDays: 31, trialUsed: 5, used: 10 }).deps,
      ),
    ).rejects.toMatchObject({ code: 'VOICE_AGENT_QUOTA' });
    await expect(
      handleVoiceStreamToken(
        request(),
        makeDeps({ trial: true, trialAgeDays: 31, trialUsed: 20, used: 3 }).deps,
      ),
    ).resolves.toBeTruthy();
  });

  it('402s VOICE_STREAM_BUDGET past 3x the command allowance, before minting (free 30, Pro 450)', async () => {
    const free = makeDeps({ mints: 30 });
    await expect(handleVoiceStreamToken(request(), free.deps)).rejects.toMatchObject({
      status: 402,
      code: 'VOICE_STREAM_BUDGET',
    });
    expect(free.fetchMock).not.toHaveBeenCalled();
    await expect(
      handleVoiceStreamToken(request(), makeDeps({ mints: 29 }).deps),
    ).resolves.toBeTruthy();
    const pro = makeDeps({ mints: 449, pro: true });
    await expect(handleVoiceStreamToken(request(), pro.deps)).resolves.toBeTruthy();
    const proSpent = makeDeps({ mints: 450, pro: true });
    await expect(handleVoiceStreamToken(request(), proSpent.deps)).rejects.toMatchObject({
      code: 'VOICE_STREAM_BUDGET',
    });
  });

  it('fails closed (503) when the stream budget cannot be checked', async () => {
    const { deps, fetchMock } = makeDeps({ mintError: true });
    await expect(handleVoiceStreamToken(request(), deps)).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs each mint with a hashed profile, tier and count, and tags the stream', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const { deps } = makeDeps({ mints: 4 });
      const body = (await (await handleVoiceStreamToken(request(), deps)).json()) as {
        url: string;
      };
      const line = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as Record<string, unknown>;
      expect(line).toMatchObject({ event: 'mint', tier: 'free', mintsThisMonth: 5, budget: 30 });
      expect(line.profile).toMatch(/^[0-9a-f]{12}$/);
      expect(JSON.stringify(line)).not.toContain(ME);
      expect(new URL(body.url).searchParams.get('tag')).toBe(`vst-${String(line.profile)}`);
    } finally {
      log.mockRestore();
    }
  });

  it('503s when the key cannot mint tokens', async () => {
    const { deps } = makeDeps({ grant: new Response('{}', { status: 403 }) });
    await expect(handleVoiceStreamToken(request(), deps)).rejects.toMatchObject({
      status: 503,
      code: 'VOICE_AGENT_UNAVAILABLE',
    });
  });

  it('returns a token and a live URL with names as keyterms', async () => {
    const { deps } = makeDeps({});
    const body = (await (await handleVoiceStreamToken(request(), deps)).json()) as {
      token: string;
      url: string;
      sampleRate: number;
    };
    expect(body.token).toBe('tmp-token');
    expect(body.sampleRate).toBe(16000);
    expect(body.url).toMatch(/^wss:\/\/api\.deepgram\.com\/v1\/listen\?/);
    expect(body.url).toContain('encoding=linear16');
    expect(body.url).toContain('numerals=true');
    expect(body.url).toContain('keyterm=Renny');
  });
});
