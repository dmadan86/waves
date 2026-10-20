/**
 * Review M8 of PR #1350: only WAV clips were measured before the upload; a
 * low-bitrate compressed clip could carry an hour in 3 MB and Deepgram billed
 * it before the measured-duration check refused the result. The WAV check also
 * trusted the header's byteRate.
 *
 * Now every clip is measured from its container before a byte is sent
 * (_shared/audioDuration.ts): PCM WAV from the fmt fields and the bytes
 * present, MP4/M4A from the movie, track and time-to-sample tables. A type
 * that cannot be measured, or bytes that do not parse, are refused (415).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mp4DurationSeconds, wavDurationSeconds } from '../../_shared/audioDuration.ts';
import { breaker, clearContextCache, handleVoiceAgent } from '../../voice-agent/handler.ts';
import { base64, mp4Bytes, wavBytes } from '../test/audio.ts';
import { FRAGMENTED_M4A_65S, PLAIN_M4A_2S } from '../test/audioFixtures.ts';
import { clipRequest, goodExpense, makeDeps, refunds, route } from './voiceDeps.ts';

beforeEach(() => {
  breaker.reset();
  clearContextCache();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

const add = [{ name: 'add_expense', input: goodExpense }];
const tooLong = { status: 413, code: 'VOICE_AGENT_CLIP_TOO_LONG' };
const unreadable = { status: 415, code: 'VOICE_AGENT_CLIP_UNREADABLE' };

function fromBase64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

describe('M8 real encoder output', () => {
  it('refuses a fragmented MP4 (moof / mvex) before Deepgram: its moov tables say nothing', async () => {
    const bytes = fromBase64(FRAGMENTED_M4A_65S);
    expect(bytes.length).toBeLessThan(3 * 1024 * 1024);
    expect(mp4DurationSeconds(bytes)).toBeNull();
    const { deps, fetchMock, rpc } = makeDeps({ fetchImpl: route('x', add, 65) });
    await expect(
      handleVoiceAgent(
        clipRequest({ audioBase64: FRAGMENTED_M4A_65S, mimeType: 'audio/mp4', durationMs: 2000 }),
        deps,
      ),
    ).rejects.toMatchObject(unreadable);
    expect(fetchMock).not.toHaveBeenCalled();
    // Refused locally, before any provider call: the command is given back.
    expect(refunds(rpc)).toHaveLength(1);
  });

  it('measures a plain M4A from FFmpeg and lets a 2 s clip through', async () => {
    expect(mp4DurationSeconds(fromBase64(PLAIN_M4A_2S))).toBeCloseTo(2, 0);
    const { deps, fetchMock } = makeDeps({ fetchImpl: route('dinner', add, 2) });
    const body = await (
      await handleVoiceAgent(
        clipRequest({ audioBase64: PLAIN_M4A_2S, mimeType: 'audio/m4a', durationMs: 2000 }),
        deps,
      )
    ).json();
    expect(body.actions).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('M8 MP4 / M4A clips are measured from their tables', () => {
  it('reads the sample table: a 2-minute M4A in a few KB is refused before Deepgram', async () => {
    const { deps, fetchMock } = makeDeps({ fetchImpl: route('x', add, 120) });
    await expect(
      handleVoiceAgent(
        clipRequest({
          audioBase64: base64(mp4Bytes(120)),
          mimeType: 'audio/mp4',
          durationMs: 4000,
        }),
        deps,
      ),
    ).rejects.toMatchObject(tooLong);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('believes the longest table, not a movie header that says 1 s', async () => {
    const { deps, fetchMock } = makeDeps({ fetchImpl: route('x', add, 120) });
    const lying = mp4Bytes(120, { mvhdSeconds: 1, mdhdSeconds: 1 });
    expect(mp4DurationSeconds(lying)).toBeGreaterThan(119);
    await expect(
      handleVoiceAgent(
        clipRequest({ audioBase64: base64(lying), mimeType: 'audio/m4a', durationMs: 1000 }),
        deps,
      ),
    ).rejects.toMatchObject(tooLong);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a short M4A, and the measured length still rules afterwards', async () => {
    const { deps, fetchMock } = makeDeps({ fetchImpl: route('dinner', add, 2) });
    const body = await (
      await handleVoiceAgent(
        clipRequest({ audioBase64: base64(mp4Bytes(2)), mimeType: 'audio/mp4', durationMs: 2000 }),
        deps,
      )
    ).json();
    expect(body.actions).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mp4DurationSeconds(mp4Bytes(3))).toBeCloseTo(3, 1);
  });

  it('refuses bytes that do not parse as the type they claim, and types it cannot measure', async () => {
    for (const [audioBase64, mimeType] of [
      [btoa('not an mp4 at all'), 'audio/m4a'],
      [btoa('not a wav at all'), 'audio/wav'],
      [base64(wavBytes(1)), 'audio/ogg'],
      [base64(wavBytes(1)), 'audio/aac'],
      [base64(mp4Bytes(1)), 'audio/webm'],
    ] as const) {
      const { deps, fetchMock, rpc } = makeDeps({ fetchImpl: route('x', add, 1) });
      await expect(
        handleVoiceAgent(clipRequest({ audioBase64, mimeType, durationMs: 1000 }), deps),
      ).rejects.toMatchObject(unreadable);
      expect(fetchMock).not.toHaveBeenCalled();
      // Refused before any provider call: the command is given back.
      expect(refunds(rpc)).toHaveLength(1);
    }
  });
});

describe('M8 the WAV header cannot under-report', () => {
  it('computes the byte rate from the fmt fields, ignoring the stored byteRate', async () => {
    const forged = wavBytes(62);
    // byteRate field says 32 MB/s, which would make 62 s of data read as 0.06 s.
    new DataView(forged.buffer).setUint32(28, 32_000_000, true);
    expect(wavDurationSeconds(forged)).toBeCloseTo(62, 1);
    const { deps, fetchMock } = makeDeps({ fetchImpl: route('x', add, 62) });
    await expect(
      handleVoiceAgent(
        clipRequest({ audioBase64: base64(forged), mimeType: 'audio/wav', durationMs: 1000 }),
        deps,
      ),
    ).rejects.toMatchObject(tooLong);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a non-PCM WAV (a compressed codec inside RIFF)', () => {
    const adpcm = wavBytes(1);
    new DataView(adpcm.buffer).setUint16(20, 2, true); // format tag 2 = MS ADPCM
    expect(wavDurationSeconds(adpcm)).toBeNull();
  });
});
