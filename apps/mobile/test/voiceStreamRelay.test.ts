/**
 * The app side of the `voice-stream` relay: the URL and subprotocols it opens
 * with, and how a refusal maps onto the fallback reasons (402 → the monthly
 * limit, anything else → a plain failure, shown as offline).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createPcmBuffer,
  isRelayReady,
  RELAY_PROTOCOL,
  relayCloseFailure,
  relayProtocols,
  relayStreamUrl,
} from '@/lib/voiceStreamPure';

const getSession = vi.fn();
vi.mock('expo-network', () => ({ getNetworkStateAsync: vi.fn() }));
vi.mock('@/lib/backend', () => ({
  backend: { auth: { getSession: (...args: unknown[]) => getSession(...args) } },
  functionsUrl: 'https://proj.supabase.co/functions/v1',
}));

const { attachStream, getStreamSession } = await import('@/lib/voiceStream');
type MicCapture = Parameters<typeof attachStream>[0];

class FakeWebSocket {
  static last: FakeWebSocket | null = null;
  readonly sent: unknown[] = [];
  binaryType = 'blob';
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code?: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
    FakeWebSocket.last = this;
  }
  send(data: unknown): void {
    this.sent.push(data);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.({ code: 1000 });
  }
  /** Closed by the relay with this code. */
  drop(code: number): void {
    this.closed = true;
    this.onclose?.({ code });
  }
}

function fakeCapture() {
  const buffer = createPcmBuffer<ArrayBuffer>(1_000_000);
  buffer.push(new ArrayBuffer(3200));
  buffer.push(new ArrayBuffer(3200));
  return {
    startedAt: Date.now(),
    buffer,
    isLive: () => true,
    stopRecorder: async () => undefined,
    discard: async () => buffer.discard(),
  } as unknown as MicCapture;
}

const handlers = () => ({ onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn() });
const session = { url: 'wss://relay/voice-stream?locale=en', protocols: ['p'] };

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  getSession.mockResolvedValue({ data: { session: { access_token: 'aaa.bbb.ccc' } } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('relay URL and subprotocols', () => {
  it('turns the functions base into a wss URL with locale and group', () => {
    expect(
      relayStreamUrl('https://proj.supabase.co/functions/v1', { locale: 'hi', groupId: 'g1' }),
    ).toBe('wss://proj.supabase.co/functions/v1/voice-stream?locale=hi&groupId=g1');
    expect(relayStreamUrl('http://127.0.0.1:54321/functions/v1', { locale: 'en' })).toBe(
      'ws://127.0.0.1:54321/functions/v1/voice-stream?locale=en',
    );
  });

  it('offers the relay protocol first and the JWT as jwt-<token>', () => {
    expect(relayProtocols('x.y.z')).toEqual([RELAY_PROTOCOL, 'jwt-x.y.z']);
  });

  it('getStreamSession builds both from the stored session, no function call', async () => {
    await expect(getStreamSession({ locale: 'en', groupId: 'g1' })).resolves.toEqual({
      kind: 'ok',
      session: {
        url: 'wss://proj.supabase.co/functions/v1/voice-stream?locale=en&groupId=g1',
        protocols: [RELAY_PROTOCOL, 'jwt-aaa.bbb.ccc'],
      },
    });
  });

  it('getStreamSession is a plain failure when signed out or the session read throws', async () => {
    getSession.mockResolvedValueOnce({ data: { session: null } });
    await expect(getStreamSession({ locale: 'en' })).resolves.toEqual({ kind: 'error' });
    getSession.mockRejectedValueOnce(new Error('storage'));
    await expect(getStreamSession({ locale: 'en' })).resolves.toEqual({ kind: 'error' });
  });
});

describe('relay error mapping', () => {
  it('reads close 4402 as the monthly limit, every other code as a failure', () => {
    expect(relayCloseFailure(4402)).toBe('quota');
    expect(relayCloseFailure(4401)).toBe('error');
    expect(relayCloseFailure(4503)).toBe('error');
    expect(relayCloseFailure(1006)).toBe('error');
    expect(relayCloseFailure(1000)).toBe('error');
    expect(relayCloseFailure(undefined)).toBe('error');
  });

  it('recognises only the relay Ready message', () => {
    expect(isRelayReady(JSON.stringify({ type: 'Ready', maxAudioSeconds: 20 }))).toBe(true);
    expect(isRelayReady(JSON.stringify({ type: 'Results', note: 'Ready' }))).toBe(false);
    expect(isRelayReady('{"Ready"')).toBe(false);
    expect(isRelayReady(new ArrayBuffer(2))).toBe(false);
  });
});

describe('attachStream over the relay', () => {
  it('opens with the session protocols, sends the held audio on open, is live on Ready', async () => {
    const pending = attachStream(fakeCapture(), session, handlers());
    const socket = FakeWebSocket.last!;
    expect(socket.url).toBe(session.url);
    expect(socket.protocols).toEqual(['p']);
    socket.onopen?.();
    expect(socket.sent).toHaveLength(2);
    socket.onmessage?.({ data: JSON.stringify({ type: 'Ready' }) });
    const result = await pending;
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') result.live.cancel();
  });

  it('maps a 402 refusal (close 4402) to quota, and leaves the capture to the caller', async () => {
    const mic = fakeCapture();
    const pending = attachStream(mic, session, handlers());
    const socket = FakeWebSocket.last!;
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify({ type: 'Error', status: 402 }) });
    socket.drop(4402);
    await expect(pending).resolves.toEqual({ kind: 'quota' });
  });

  it('maps any other refusal or a dropped connection to a plain failure', async () => {
    for (const code of [4401, 4503, 1006]) {
      const pending = attachStream(fakeCapture(), session, handlers());
      FakeWebSocket.last!.drop(code);
      await expect(pending).resolves.toEqual({ kind: 'error' });
    }
  });

  it('gives up if the relay never says Ready', async () => {
    vi.useFakeTimers();
    const pending = attachStream(fakeCapture(), session, handlers());
    const socket = FakeWebSocket.last!;
    socket.onopen?.();
    await vi.advanceTimersByTimeAsync(6000);
    await expect(pending).resolves.toEqual({ kind: 'error' });
    expect(socket.closed).toBe(true);
  });

  it('reports the relay cutting a live stream as an error, keeping the words', async () => {
    const h = handlers();
    const pending = attachStream(fakeCapture(), session, h);
    const socket = FakeWebSocket.last!;
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify({ type: 'Ready' }) });
    await pending;
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'Results',
        is_final: true,
        channel: { alternatives: [{ transcript: 'paid 500' }] },
      }),
    });
    expect(h.onFinal).toHaveBeenCalledWith('paid 500');
    socket.drop(1000);
    expect(h.onError).toHaveBeenCalled();
  });
});
