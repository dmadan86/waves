import { describe, expect, it } from 'vitest';

import { formatVoiceDiag } from '@/lib/voiceDiagPure';
import {
  base64ToBytes,
  batchAfterAttachFailure,
  bytesToBase64,
  createPcmBuffer,
  joinChunks,
} from '@/lib/voiceStreamPure';

describe('batch fallback decision', () => {
  it('keeps the audio for a failed connection, not for the spent allowance or a dead mic', () => {
    expect(batchAfterAttachFailure('error', true)).toBe(true);
    expect(batchAfterAttachFailure('quota', true)).toBe(false);
    expect(batchAfterAttachFailure('error', false)).toBe(false);
  });
});

describe('pcm buffer keeps what it sent', () => {
  it('still has every chunk after attach, and nothing after discard', () => {
    const buffer = createPcmBuffer<ArrayBuffer>(100);
    const sent: number[] = [];
    buffer.push(new Uint8Array([1, 2]).buffer);
    buffer.attach((c) => sent.push(c.byteLength));
    buffer.push(new Uint8Array([3]).buffer);
    expect(sent).toEqual([2, 1]);
    expect(Array.from(joinChunks(buffer.chunks()))).toEqual([1, 2, 3]);
    buffer.discard();
    expect(buffer.chunks()).toEqual([]);
  });
  it('stops keeping at the cap', () => {
    const buffer = createPcmBuffer<ArrayBuffer>(3);
    buffer.push(new Uint8Array(2).buffer);
    buffer.push(new Uint8Array(2).buffer);
    expect(buffer.chunks()).toHaveLength(1);
  });
});

describe('bytesToBase64', () => {
  it('round-trips every padding length', () => {
    for (const bytes of [[], [1], [1, 2], [1, 2, 3], [255, 0, 128, 7]]) {
      const input = new Uint8Array(bytes);
      expect(Array.from(base64ToBytes(bytesToBase64(input)))).toEqual(bytes);
    }
    expect(bytesToBase64(new TextEncoder().encode('Ma'))).toBe('TWE=');
  });
});

describe('formatVoiceDiag', () => {
  it('names the engine, timings and length', () => {
    expect(
      formatVoiceDiag({ engine: 'cloud-stream', firstFrameMs: 120.4, attachMs: 850, attachFailed: null, chars: 24 }),
    ).toBe('cloud-stream · 1st frame 120ms · attach 850ms · 24 chars');
  });
  it('shows the failure and a pending length', () => {
    expect(
      formatVoiceDiag({ engine: 'cloud-batch', firstFrameMs: null, attachMs: null, attachFailed: 'no connection', chars: null }),
    ).toBe('cloud-batch · 1st frame - · attach failed: no connection · … chars');
    expect(
      formatVoiceDiag({ engine: 'phone', firstFrameMs: 40, attachMs: null, attachFailed: null, chars: 5 }),
    ).toContain('attach n/a');
  });
});
