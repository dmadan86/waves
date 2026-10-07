/**
 * Graceful degradation on the app side (docs/voice-failure-modes.md): every
 * cloud failure ends in the on-device path with an honest badge, and nothing
 * waits forever — the agent call is cut at 10 s, the relay socket at 4 s.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentFailureOf, resultFromError, withTimeout } from '@/lib/voiceAgentPure';
import {
  AGENT_CALL_TIMEOUT_MS,
  engineAfterAgentFailure,
  resolveEngine,
} from '@/lib/voiceEnginePure';
import { createPcmBuffer } from '@/lib/voiceStreamPure';

const invoke = vi.fn();
vi.mock('expo-network', () => ({ getNetworkStateAsync: vi.fn() }));
vi.mock('@/lib/backend', () => ({
  backend: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    auth: { getSession: vi.fn() },
  },
  functionsUrl: 'https://proj.supabase.co/functions/v1',
}));

const { callVoiceAgent } = await import('@/lib/voiceAgent');
const { attachStream, SOCKET_OPEN_TIMEOUT_MS } = await import('@/lib/voiceStream');

const request = {
  schemaVersion: 1,
  transcript: 'paid 500 for lunch',
  locale: 'en',
  today: '2026-10-07',
} as const;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  invoke.mockReset();
});

describe('fallback reason → badge', () => {
  it('maps every agent failure onto an honest engine reason', () => {
    expect(engineAfterAgentFailure('quota', true)).toEqual({
      engine: 'on-device',
      reason: 'quota',
    });
    expect(engineAfterAgentFailure('quota', false).reason).toBe('quota');
    for (const failure of ['timeout', 'unavailable', 'error'] as const) {
      expect(engineAfterAgentFailure(failure, true)).toEqual({
        engine: 'on-device',
        reason: 'cloud-down',
      });
      expect(engineAfterAgentFailure(failure, false).reason).toBe('offline');
    }
  });

  it('maps server answers onto failures: 503 unavailable, 402 quota, else error', () => {
    const fail = (code: string | null, status: number | null) => {
      const result = resultFromError(code, status);
      if (result.kind === 'ok') throw new Error('not a failure');
      return agentFailureOf(result);
    };
    expect(fail('VOICE_AGENT_UNAVAILABLE', 503)).toBe('unavailable');
    expect(fail(null, 503)).toBe('unavailable');
    expect(fail('VOICE_AGENT_QUOTA', 402)).toBe('quota');
    expect(fail('INTERNAL', 500)).toBe('error');
    expect(fail('RATE_LIMITED', 429)).toBe('error');
    expect(agentFailureOf({ kind: 'timeout' })).toBe('timeout');
  });

  it('a stream that will not open while online says "Cloud unavailable", never "Offline"', () => {
    expect(
      resolveEngine({ enabled: true, online: true, streamOk: false, streamAvailable: true }),
    ).toEqual({ engine: 'on-device', reason: 'cloud-down' });
  });
});

describe('withTimeout', () => {
  beforeEach(() => vi.useFakeTimers());

  it('passes a timely answer through and clears its timer', async () => {
    const abort = vi.fn();
    await expect(withTimeout(Promise.resolve(1), 100, () => 0, abort)).resolves.toBe(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(abort).not.toHaveBeenCalled();
  });

  it('answers with the fallback and aborts the work when it is late', async () => {
    const abort = vi.fn();
    const pending = withTimeout(new Promise<number>(() => undefined), 100, () => 0, abort);
    await vi.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toBe(0);
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('ignores a late answer after the fallback', async () => {
    let finish: (n: number) => void = () => undefined;
    const pending = withTimeout(
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
      100,
      () => 0,
    );
    await vi.advanceTimersByTimeAsync(100);
    finish(7);
    await expect(pending).resolves.toBe(0);
  });
});

describe('callVoiceAgent never leaves the screen on "Understanding…"', () => {
  it('times out at 10 s with kind "timeout", aborting the request', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    invoke.mockImplementation(
      (_name: string, options: { signal?: AbortSignal }) =>
        new Promise(() => {
          signal = options.signal;
        }),
    );
    const pending = callVoiceAgent(request);
    await vi.advanceTimersByTimeAsync(AGENT_CALL_TIMEOUT_MS - 1);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ kind: 'timeout' });
    expect(signal?.aborted).toBe(true);
  });

  it('turns a thrown network error into a plain error (falls back at once)', async () => {
    invoke.mockRejectedValue(new TypeError('Network request failed'));
    await expect(callVoiceAgent(request)).resolves.toEqual({ kind: 'error' });
  });

  it('reads a 503 VOICE_AGENT_UNAVAILABLE body as unavailable', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        context: new Response(JSON.stringify({ code: 'VOICE_AGENT_UNAVAILABLE' }), {
          status: 503,
        }),
      },
    });
    await expect(callVoiceAgent(request)).resolves.toEqual({ kind: 'unavailable' });
  });

  it('reads a malformed 200 body as an error', async () => {
    invoke.mockResolvedValue({ data: { nope: true }, error: null });
    await expect(callVoiceAgent(request)).resolves.toEqual({ kind: 'error' });
  });
});

describe('the relay socket is given up on, not waited on', () => {
  class SilentSocket {
    static last: SilentSocket | null = null;
    binaryType = 'blob';
    closed = false;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onclose: ((event: { code?: number }) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
      SilentSocket.last = this;
    }
    send(): void {}
    close(): void {
      this.closed = true;
    }
  }

  const capture = () => {
    const buffer = createPcmBuffer<ArrayBuffer>(1_000_000);
    return {
      startedAt: Date.now(),
      buffer,
      isLive: () => true,
      stopRecorder: async () => undefined,
      discard: async () => buffer.discard(),
    } as unknown as Parameters<typeof attachStream>[0];
  };
  const handlers = () => ({ onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn() });

  it('fails at 4 s when the socket never opens (offline, relay down or cold)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', SilentSocket);
    const pending = attachStream(capture(), { url: 'wss://x', protocols: [] }, handlers());
    await vi.advanceTimersByTimeAsync(SOCKET_OPEN_TIMEOUT_MS);
    await expect(pending).resolves.toEqual({ kind: 'error' });
    expect(SilentSocket.last?.closed).toBe(true);
  });

  it('an opened socket gets the full Ready budget (the relay may take its 4 s upstream)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', SilentSocket);
    const pending = attachStream(capture(), { url: 'wss://x', protocols: [] }, handlers());
    await vi.advanceTimersByTimeAsync(500);
    SilentSocket.last!.onopen?.();
    await vi.advanceTimersByTimeAsync(SOCKET_OPEN_TIMEOUT_MS);
    SilentSocket.last!.onmessage?.({ data: JSON.stringify({ type: 'Ready' }) });
    const result = await pending;
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') result.live.cancel();
  });
});
