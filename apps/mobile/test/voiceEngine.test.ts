import { describe, expect, it } from 'vitest';

import {
  isOnline,
  planMicStart,
  resolveEngine,
  STREAM_FIRST_WORD_MS,
  STREAM_SILENCE_MS,
  STREAM_MAX_SESSION_MS,
} from '@/lib/voiceEnginePure';

describe('resolveEngine', () => {
  it('is cloud when enabled, online and the stream opened', () => {
    expect(resolveEngine({ enabled: true, online: true, streamOk: true })).toEqual({
      engine: 'cloud',
      reason: null,
    });
  });
  it('names the free plan when not enabled, even offline', () => {
    expect(resolveEngine({ enabled: false, online: false })).toEqual({
      engine: 'on-device',
      reason: 'free',
    });
  });
  it('names the monthly limit', () => {
    expect(resolveEngine({ enabled: true, online: true, quotaReached: true }).reason).toBe('quota');
  });
  it('names the monthly limit, not offline, when the stream token was refused with 402', () => {
    expect(
      resolveEngine({ enabled: true, online: true, quotaReached: true, streamOk: false }).reason,
    ).toBe('quota');
  });
  it('names offline when there is no connection', () => {
    expect(resolveEngine({ enabled: true, online: false }).reason).toBe('offline');
  });
  it('treats a stream that would not open as offline, unless the build cannot stream', () => {
    expect(resolveEngine({ enabled: true, online: true, streamOk: false }).reason).toBe('offline');
    expect(
      resolveEngine({ enabled: true, online: true, streamOk: false, streamAvailable: false })
        .reason,
    ).toBeNull();
  });
});

describe('isOnline', () => {
  it('only reads offline when told so', () => {
    expect(isOnline(null)).toBe(true);
    expect(isOnline({ isConnected: true, isInternetReachable: null })).toBe(true);
    expect(isOnline({ isConnected: false })).toBe(false);
    expect(isOnline({ isConnected: true, isInternetReachable: false })).toBe(false);
  });
});

describe('planMicStart', () => {
  const base = { enabled: true, online: true };
  it('streams for a tap and a hold alike', () => {
    expect(planMicStart({ ...base, held: false }).stream).toBe(true);
    expect(planMicStart({ ...base, held: true }).stream).toBe(true);
  });
  it('every session can end by itself: a tap on a short pause, a hold on a longer one', () => {
    const tap = planMicStart({ ...base, held: false });
    expect([tap.silenceMs, tap.firstWordMs]).toEqual([STREAM_SILENCE_MS, STREAM_FIRST_WORD_MS]);
    const hold = planMicStart({ ...base, held: true });
    expect([hold.silenceMs, hold.firstWordMs]).toEqual([
      STREAM_SILENCE_MS * 2,
      STREAM_FIRST_WORD_MS,
    ]);
    expect(STREAM_FIRST_WORD_MS).toBeLessThanOrEqual(5000);
    expect(STREAM_MAX_SESSION_MS).toBeLessThanOrEqual(30_000);
  });
  it('falls back with the reason, for either start', () => {
    for (const held of [false, true]) {
      expect(planMicStart({ enabled: false, online: true, held }).fallback?.reason).toBe('free');
      expect(planMicStart({ enabled: true, online: false, held })).toMatchObject({
        stream: false,
        fallback: { reason: 'offline' },
      });
    }
  });
});
