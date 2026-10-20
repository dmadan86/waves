/**
 * CodeRabbit on PR #1350:
 *  - a command the phone parsed itself is metered with `meterOnly` and then
 *    saved locally; the follow-up about it needs a slot, so the meter-only
 *    path opens one too (same budget: one charged command, three turns);
 *  - the live-stream gate's command peek (`remainingCommands`) counted only
 *    `active` subscriptions while the database meters `grace` as paid, so a
 *    Pro in a card retry lost streaming after ten commands.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { remainingCommands } from '../../_shared/voiceStreamGate.ts';
import {
  breaker,
  clearContextCache,
  FOLLOWUP_PER_EXPENSE,
  FOLLOWUP_WINDOW_SECONDS,
  handleVoiceAgent,
} from '../../voice-agent/handler.ts';
import { makeDeps, ME, textRequest } from './voiceDeps.ts';

beforeEach(() => {
  breaker.reset();
  clearContextCache();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('meterOnly opens a follow-up slot', () => {
  it('a metered-only command opens a slot with the same caps, and calls no provider', async () => {
    const { deps, rpc, fetchMock } = makeDeps();
    const res = await handleVoiceAgent(textRequest({ meterOnly: true }), deps);
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('waves_voice_agent_followup_open', {
      p_profile: ME,
      p_turns: FOLLOWUP_PER_EXPENSE,
      p_window_seconds: FOLLOWUP_WINDOW_SECONDS,
    });
  });

  it('a refused meter-only command opens nothing', async () => {
    const { deps, rpc } = makeDeps({
      quota: { used: 10, limit: 10, tier: 'free', allowed: false, month: '2026-10' },
    });
    await expect(handleVoiceAgent(textRequest({ meterOnly: true }), deps)).rejects.toMatchObject({
      status: 402,
    });
    expect(rpc.mock.calls.map(([n]) => n)).not.toContain('waves_voice_agent_followup_open');
  });
});

describe('the stream gate peek counts grace as paid', () => {
  function service(rows: unknown[], used: number) {
    const from = (t: string) => {
      const q: Record<string, unknown> = {};
      const filters: string[] = [];
      for (const m of ['select', 'eq', 'in']) {
        q[m] = (...args: unknown[]) => {
          filters.push(`${m}:${JSON.stringify(args)}`);
          return q;
        };
      }
      q.maybeSingle = async () => ({
        data: t === 'voice_agent_usage' ? { count: used } : null,
        error: null,
      });
      q.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: t === 'subscriptions' ? rows : [], error: null });
      (q as { filters: string[] }).filters = filters;
      calls.push({ table: t, q });
      return q;
    };
    const calls: { table: string; q: Record<string, unknown> }[] = [];
    return { from, calls };
  }

  it('asks for active and grace rows, and gives a grace Pro the Pro allowance', async () => {
    const s = service(
      [{ tier: 'pro', status: 'grace', store: 'play', current_period_end: '2999-01-01' }],
      30,
    );
    const left = await remainingCommands(s as never, ME, new Date('2026-10-20T00:00:00Z'));
    expect(left).toBe(100 - 30);
    const subs = s.calls.find((c) => c.table === 'subscriptions')!.q as { filters: string[] };
    expect(subs.filters).toContainEqual('in:["status",["active","grace"]]');
  });
});
