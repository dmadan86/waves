/**
 * WAV-10 / M4: a Free account could send audio (cloud transcription was meant
 * for Pro and the trial, like the live stream), the clip's length was the
 * client's word (`durationMs`), and 12 MB of low-bitrate audio was "60 s".
 *
 * Now audio needs Pro or the trial (decided from the quota's tier, refunded
 * before any byte reaches Deepgram), the ceiling is 3 MB, a WAV header is
 * read before the upload and Deepgram's measured duration is enforced after.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  breaker,
  clearContextCache,
  handleVoiceAgent,
  MAX_AUDIO_BYTES,
  MAX_CLIP_SECONDS,
  wavDurationSeconds,
} from '../../voice-agent/handler.ts';
import {
  base64,
  clipRequest,
  goodExpense,
  makeDeps,
  ME,
  refunds,
  route,
  wavBytes,
} from './voiceDeps.ts';

beforeEach(() => {
  breaker.reset();
  clearContextCache();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

const add = [{ name: 'add_expense', input: goodExpense }];

describe('WAV-10 who may send audio', () => {
  it('refuses a Free clip with 403 VOICE_STREAM_FREE_TIER, refunds the command, never calls Deepgram', async () => {
    const { deps, rpc, fetchMock } = makeDeps({
      quota: { used: 1, limit: 10, tier: 'free', allowed: true, month: '2026-10' },
      fetchImpl: route('dinner', add),
    });
    await expect(handleVoiceAgent(clipRequest(), deps)).rejects.toMatchObject({
      status: 403,
      code: 'VOICE_STREAM_FREE_TIER',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refunds(rpc)).toEqual([{ p_profile: ME, p_month: '2026-10', p_trial: false }]);
  });

  it('lets the trial pool and Pro send audio', async () => {
    for (const quota of [
      { used: 1, limit: 20, tier: 'free' as const, trial: true, allowed: true, month: '2026-10' },
      { used: 1, limit: 100, tier: 'pro' as const, allowed: true, month: '2026-10' },
    ]) {
      const { deps, fetchMock } = makeDeps({ quota, fetchImpl: route('dinner', add, 3) });
      const body = await (await handleVoiceAgent(clipRequest(), deps)).json();
      expect(body.actions).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  });

  it('Free text commands are unaffected', async () => {
    const { deps } = makeDeps({
      quota: { used: 1, limit: 10, tier: 'free', allowed: true, month: '2026-10' },
      fetchImpl: route('dinner', add),
    });
    const res = await handleVoiceAgent(
      new Request('https://x/voice-agent', {
        method: 'POST',
        body: JSON.stringify({
          schemaVersion: 1,
          transcript: 'dinner 1200 with Anu',
          locale: 'en',
          today: '2026-10-07',
          groupId: 'g1',
        }),
      }),
      deps,
    );
    expect(res.status).toBe(200);
  });
});

describe('WAV-10 the clip length is measured, not declared', () => {
  it('413s a clip Deepgram measured over the cap, keeps the command, returns no transcript', async () => {
    const { deps, rpc } = makeDeps({ fetchImpl: route('a very long clip', add, 90) });
    await expect(handleVoiceAgent(clipRequest({ durationMs: 4000 }), deps)).rejects.toMatchObject({
      status: 413,
      code: 'VOICE_AGENT_CLIP_TOO_LONG',
    });
    expect(refunds(rpc)).toHaveLength(0);
  });

  it('reads a WAV header: a 62 s WAV declared as 4 s is refused before the upload, and refunded', async () => {
    const { deps, fetchMock, rpc } = makeDeps({ fetchImpl: route('x', add, 62) });
    const clip = wavBytes(62, 62 * 32000); // real bytes behind the header, under the byte cap
    await expect(
      handleVoiceAgent(
        clipRequest({ audioBase64: base64(clip), mimeType: 'audio/wav', durationMs: 4000 }),
        deps,
      ),
    ).rejects.toMatchObject({ status: 413, code: 'VOICE_AGENT_CLIP_TOO_LONG' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refunds(rpc)).toHaveLength(1);
    // The header may claim more than the clip carries; the bytes decide.
    expect(wavDurationSeconds(wavBytes(120, 64))).toBeCloseTo(0.002, 3);
    expect(wavDurationSeconds(wavBytes(2, 2 * 32000))).toBeCloseTo(2, 2);
    expect(wavDurationSeconds(new Uint8Array(10))).toBeNull();
  });

  it('413s more than the byte ceiling before reserving anything', async () => {
    const { deps, rpc } = makeDeps({ fetchImpl: route('x', add, 1) });
    const big = 'A'.repeat(Math.ceil((MAX_AUDIO_BYTES + 1024) / 0.75));
    await expect(handleVoiceAgent(clipRequest({ audioBase64: big }), deps)).rejects.toMatchObject({
      status: 413,
    });
    expect(rpc).not.toHaveBeenCalledWith('waves_voice_agent_quota', expect.anything());
    expect(MAX_AUDIO_BYTES).toBe(3 * 1024 * 1024);
    expect(MAX_CLIP_SECONDS).toBe(61);
  });
});
