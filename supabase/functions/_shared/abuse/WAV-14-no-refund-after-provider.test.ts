/**
 * WAV-14 / M4 / WAV-13: a command was refunded on any failure after the
 * provider was asked (a Deepgram error, a model timeout, an answer that did
 * not validate), so a client that could provoke one had unlimited free
 * attempts; and the refund named no bucket.
 *
 * Now the command stays spent from the first provider request, and a refund
 * (only before that point) names the month and pool the reservation reported.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { breaker, clearContextCache, handleVoiceAgent } from '../../voice-agent/handler.ts';
import {
  clipRequest,
  deepgram,
  goodExpense,
  makeDeps,
  ME,
  openrouter,
  refunds,
  route,
  textRequest,
} from './voiceDeps.ts';

beforeEach(() => {
  breaker.reset();
  clearContextCache();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

const add = [{ name: 'add_expense', input: goodExpense }];

describe('WAV-14 the command stays spent once a provider was asked', () => {
  it('Deepgram 5xx: 503, no refund', async () => {
    const { deps, rpc } = makeDeps({ fetchImpl: () => new Response('down', { status: 503 }) });
    await expect(handleVoiceAgent(clipRequest(), deps)).rejects.toMatchObject({ status: 503 });
    expect(refunds(rpc)).toHaveLength(0);
  });

  it('every model fails: 503, no refund', async () => {
    const { deps, rpc, fetchMock } = makeDeps({
      fetchImpl: () => new Response('bad gateway', { status: 502 }),
    });
    await expect(handleVoiceAgent(textRequest(), deps)).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalled();
    expect(refunds(rpc)).toHaveLength(0);
  });

  it('an answer that does not validate is the "ask again", charged', async () => {
    const { deps, rpc } = makeDeps({
      fetchImpl: route('uh', [{ name: 'add_expense', input: {} }]),
    });
    const body = await (await handleVoiceAgent(textRequest(), deps)).json();
    expect(body.actions).toEqual([]);
    expect(body.clarify).toBeTruthy();
    expect(body.quota.used).toBe(3);
    expect(refunds(rpc)).toHaveLength(0);
  });

  it('an empty transcript is 422, charged', async () => {
    const { deps, rpc } = makeDeps({ fetchImpl: () => deepgram('   ') });
    await expect(handleVoiceAgent(clipRequest(), deps)).rejects.toMatchObject({ status: 422 });
    expect(refunds(rpc)).toHaveLength(0);
  });
});

describe('WAV-13 a refund before any provider call names its bucket', () => {
  it('a context read that fails after the reservation refunds the month the quota reported', async () => {
    const { deps, rpc, fetchMock } = makeDeps({
      groupsError: true,
      quota: { used: 2, limit: 20, tier: 'free', trial: true, allowed: true, month: '2026-09' },
      fetchImpl: route('dinner', add),
    });
    await expect(handleVoiceAgent(textRequest(), deps)).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refunds(rpc)).toEqual([{ p_profile: ME, p_month: '2026-09', p_trial: true }]);
  });

  it('a successful command is never refunded', async () => {
    const { deps, rpc } = makeDeps({ fetchImpl: () => openrouter(add) });
    const body = await (await handleVoiceAgent(textRequest(), deps)).json();
    expect(body.actions).toHaveLength(1);
    expect(refunds(rpc)).toHaveLength(0);
  });
});
