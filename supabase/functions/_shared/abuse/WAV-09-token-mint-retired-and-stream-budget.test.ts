/**
 * WAV-09 / H1: the legacy `voice-stream-token` handed the phone a raw Deepgram
 * token; one mint bought unbounded minutes. M6: stream mints were the only
 * bound on the minutes the relay streams.
 *
 * Now the token function is a 410 tombstone, is out of the deploy list, and the
 * relay's gate hands the database a seconds budget beside the mint budget.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { VOICE_STREAM_PRO_MONTHLY } from '../../_shared/core.js';
import { admitStream, STREAM_SECONDS_PER_MINT } from '../../_shared/voiceStreamGate.ts';
import { handleVoiceStreamToken } from '../../voice-stream-token/handler.ts';

describe('WAV-09 the token mint is retired', () => {
  it('is no longer in the edge:deploy list', () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../../../package.json', import.meta.url)), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts['edge:deploy']).not.toContain('voice-stream-token');
    expect(pkg.scripts['edge:deploy']).toContain('voice-stream ');
  });

  it('answers 410 and asks Deepgram for nothing', async () => {
    const fetchMock = vi.fn();
    await expect(
      handleVoiceStreamToken(new Request('https://x/voice-stream-token', { method: 'POST' }), {
        env: () => 'dg',
        caller: {} as never,
        service: {} as never,
        fetch: fetchMock as unknown as typeof fetch,
        rateLimit: async () => undefined,
      }),
    ).rejects.toMatchObject({ status: 410 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('M6 the stream gate hands the database a seconds budget', () => {
  function gate(mint: Record<string, unknown>) {
    const rpc = vi.fn(async (name: string) => {
      if (name === 'waves_voice_agent_enabled') return { data: true, error: null };
      if (name === 'waves_voice_stream_mint') return { data: mint, error: null };
      return { data: null, error: null };
    });
    const from = (t: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) q[m] = () => q;
      q.maybeSingle = async () => ({
        data: t === 'voice_agent_usage' ? { count: 0 } : null,
        error: null,
      });
      q.then = (resolve: (v: unknown) => unknown) =>
        resolve({
          data:
            t === 'subscriptions'
              ? [{ tier: 'pro', store: 'play', status: 'active', current_period_end: null }]
              : [],
          error: null,
        });
      return q;
    };
    return {
      rpc,
      deps: {
        env: (n: string) => ({ DEEPGRAM_API_KEY: 'dg' })[n],
        caller: { auth: { getUser: async () => ({ data: { user: { id: 'me' } }, error: null }) } },
        service: { rpc, from },
        rateLimit: async () => undefined,
      } as never,
    };
  }

  it('passes p_seconds_budget = mint budget x 20 s', async () => {
    const { deps, rpc } = gate({ allowed: true, mints: 1, budget: 300, tier: 'pro' });
    await admitStream(deps, 'voice-stream');
    expect(rpc).toHaveBeenCalledWith(
      'waves_voice_stream_mint',
      expect.objectContaining({
        p_seconds_budget: VOICE_STREAM_PRO_MONTHLY * STREAM_SECONDS_PER_MINT,
      }),
    );
    expect(STREAM_SECONDS_PER_MINT).toBe(20);
  });

  it('a seconds_budget refusal is 402 VOICE_STREAM_BUDGET, like a spent mint budget', async () => {
    const { deps } = gate({
      allowed: false,
      mints: 12,
      budget: 300,
      tier: 'pro',
      reason: 'seconds_budget',
    });
    await expect(admitStream(deps, 'voice-stream')).rejects.toMatchObject({
      status: 402,
      code: 'VOICE_STREAM_BUDGET',
    });
  });
});
