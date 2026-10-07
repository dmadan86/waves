/**
 * The relay: the same gate as the token mint, then audio up / results down, and
 * the caps that hold whatever the client does (20 s of audio, 25 s of wall
 * time, 5 s idle, frame and byte limits), each ending with CloseStream and a
 * bounded flush.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearContextCache } from '../voice-agent/handler.ts';
import {
  BYTE_MARGIN,
  FLUSH_MS,
  IDLE_MS,
  MAX_AUDIO_BYTES,
  MAX_WALL_MS,
  RELAY_PROTOCOL,
  UPSTREAM_OPEN_MS,
  handleVoiceStream,
  readCredentials,
  runRelay,
  type RelayDeps,
  type RelaySocket,
  type RelaySummary,
} from './handler.ts';

const ME = 'profile-me';
const CHUNK = 3200; // 100 ms of 16 kHz linear16

class FakeSocket implements RelaySocket {
  readyState = 0;
  binaryType = 'blob';
  readonly sent: (string | Uint8Array)[] = [];
  closed: { code?: number; reason?: string } | null = null;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  send(data: string | ArrayBuffer | Uint8Array): void {
    if (this.readyState !== 1) throw new Error('not open');
    this.sent.push(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
  }
  close(code?: number, reason?: string): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.closed = { code, reason };
    this.onclose?.({});
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(data: unknown): void {
    this.onmessage?.({ data });
  }
  /** Closed by the far end. */
  drop(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
  get texts(): Record<string, unknown>[] {
    return this.sent
      .filter((d): d is string => typeof d === 'string')
      .map((d) => JSON.parse(d) as Record<string, unknown>);
  }
  get audioBytes(): number {
    return this.sent.reduce((n, d) => n + (typeof d === 'string' ? 0 : d.byteLength), 0);
  }
}

function table(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  for (const m of ['select', 'is', 'order', 'limit', 'in']) q[m] = chain;
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
  return q;
}

function makeDeps(over: { authFails?: boolean; used?: number; mints?: number } = {}) {
  const upstreams: FakeSocket[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const connectUpstream = vi.fn((url: string, key: string) => {
    void url;
    void key;
    const socket = new FakeSocket();
    upstreams.push(socket);
    return socket;
  });
  const caller = {
    auth: {
      getUser: async () =>
        over.authFails
          ? { data: { user: null }, error: { message: 'bad jwt' } }
          : { data: { user: { id: ME } }, error: null },
    },
    from: (t: string) =>
      table(
        t === 'groups'
          ? [{ id: 'g1', name: 'Goa', type: 'trip', default_currency: 'INR' }]
          : t === 'group_members'
            ? [
                {
                  id: 'm-renny',
                  group_id: 'g1',
                  profile_id: null,
                  ghost_name: 'Renny',
                  profile: null,
                },
              ]
            : [],
      ),
  };
  const deps: RelayDeps = {
    env: (n) => ({ DEEPGRAM_API_KEY: 'dg-key' })[n],
    service: {
      rpc: async (name: string, args: Record<string, number>) => {
        rpcCalls.push({ name, args });
        if (name === 'waves_voice_stream_mint') {
          const used = over.mints ?? 0;
          const budget = args.p_free_budget;
          return {
            data: { allowed: used < budget, mints: used + 1, budget, tier: 'free' },
            error: null,
          };
        }
        if (name === 'waves_voice_stream_seconds') return { data: 1, error: null };
        return { data: true, error: null };
      },
      from: (t: string) => {
        const q: Record<string, unknown> = {};
        const chain = () => q;
        for (const m of ['select', 'eq']) q[m] = chain;
        q.maybeSingle = async () => ({
          data: t === 'voice_agent_usage' ? { count: over.used ?? 0 } : null,
          error: null,
        });
        q.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
        return q;
      },
    } as never,
    callerFor: vi.fn(() => caller as never),
    rateLimit: async () => undefined,
    upgrade: vi.fn(() => ({ socket: new FakeSocket(), response: new Response(null) })),
    connectUpstream,
    waitUntil: vi.fn(),
  };
  return { deps, upstreams, rpcCalls, connectUpstream };
}

/** Let the gate's promises (and crypto.subtle) run. Timers stay faked. */
async function settle(): Promise<void> {
  for (let i = 0; i < 40; i++) await new Promise((resolve) => setImmediate(resolve));
}

const session = { jwt: 'jwt-abc', locale: 'en', groupId: 'g1' };

/** A relay with an open client and, unless refused, a connected Deepgram. */
async function started(over: Parameters<typeof makeDeps>[0] = {}, connect = true) {
  const made = makeDeps(over);
  const client = new FakeSocket();
  const done = runRelay(client, session, made.deps);
  client.open();
  // Wait for the gate to finish and Deepgram to be dialled — however many
  // turns that takes on a slow CI box — rather than a fixed number of turns.
  await settle();
  for (let i = 0; i < 2000 && made.upstreams.length === 0 && !client.closed; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const upstream = made.upstreams[0];
  if (connect && upstream) upstream.open();
  return { ...made, client, upstream, done };
}

const audio = (bytes = CHUNK) => new Uint8Array(bytes).fill(7).buffer;

let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  clearContextCache();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('handleVoiceStream (before the upgrade)', () => {
  it('426s a plain HTTP request', () => {
    const { deps } = makeDeps();
    const response = handleVoiceStream(new Request('https://x/voice-stream'), deps);
    expect(response.status).toBe(426);
    expect(deps.upgrade).not.toHaveBeenCalled();
  });

  it('401s an upgrade with no token, without upgrading', () => {
    const { deps } = makeDeps();
    const response = handleVoiceStream(
      new Request('https://x/voice-stream', { headers: { upgrade: 'websocket' } }),
      deps,
    );
    expect(response.status).toBe(401);
    expect(deps.upgrade).not.toHaveBeenCalled();
  });

  it('upgrades with the relay subprotocol selected and keeps the worker alive', () => {
    const { deps } = makeDeps();
    handleVoiceStream(
      new Request('https://x/voice-stream?locale=hi&groupId=g1', {
        headers: {
          upgrade: 'websocket',
          'sec-websocket-protocol': `${RELAY_PROTOCOL}, jwt-eyJ.a.b`,
        },
      }),
      deps,
    );
    expect(deps.upgrade).toHaveBeenCalledWith(expect.any(Request), RELAY_PROTOCOL);
    expect(deps.callerFor).toHaveBeenCalledWith('eyJ.a.b');
    expect(deps.waitUntil).toHaveBeenCalledWith(expect.any(Promise));
  });
});

describe('readCredentials', () => {
  it('reads the JWT from a jwt- subprotocol and never echoes that one', () => {
    const request = new Request('https://x/', {
      headers: { 'sec-websocket-protocol': `jwt-tok.en.x, ${RELAY_PROTOCOL}` },
    });
    expect(readCredentials(request)).toEqual({ jwt: 'tok.en.x', protocol: RELAY_PROTOCOL });
  });

  it('falls back to ?access_token= (and ?jwt=)', () => {
    expect(readCredentials(new Request('https://x/?access_token=a.b.c')).jwt).toBe('a.b.c');
    expect(readCredentials(new Request('https://x/?jwt=d.e.f')).jwt).toBe('d.e.f');
    expect(readCredentials(new Request('https://x/'))).toEqual({
      jwt: null,
      protocol: undefined,
    });
  });
});

describe('runRelay: the gate', () => {
  it('refuses a bad token with 4401 and never dials Deepgram', async () => {
    const { client, connectUpstream, done } = await started({ authFails: true });
    expect(client.texts).toContainEqual(
      expect.objectContaining({ type: 'Error', status: 401, code: 'NOT_AUTHENTICATED' }),
    );
    expect(client.closed?.code).toBe(4401);
    expect(connectUpstream).not.toHaveBeenCalled();
    await expect(done).resolves.toMatchObject({ reason: 'NOT_AUTHENTICATED', bytes: 0 });
  });

  it('refuses a spent stream budget with 4402 VOICE_STREAM_BUDGET', async () => {
    const { client, connectUpstream } = await started({ mints: 30 });
    expect(client.texts).toContainEqual(
      expect.objectContaining({ status: 402, code: 'VOICE_STREAM_BUDGET' }),
    );
    expect(client.closed?.code).toBe(4402);
    expect(connectUpstream).not.toHaveBeenCalled();
  });

  it('refuses a spent command allowance with 4402 VOICE_AGENT_QUOTA, before minting', async () => {
    const { client, rpcCalls } = await started({ used: 10 });
    expect(client.texts).toContainEqual(expect.objectContaining({ code: 'VOICE_AGENT_QUOTA' }));
    expect(client.closed?.code).toBe(4402);
    expect(rpcCalls.map((c) => c.name)).not.toContain('waves_voice_stream_mint');
  });

  it('sends a refusal that lands before the client socket opened once it opens', async () => {
    const made = makeDeps({ authFails: true });
    const client = new FakeSocket();
    void runRelay(client, session, made.deps);
    await settle();
    expect(client.closed).toBeNull();
    client.open();
    expect(client.texts[0]).toMatchObject({ type: 'Error', status: 401 });
    expect(client.closed?.code).toBe(4401);
  });

  it('dials Deepgram with the server key, the caller names and the tag', async () => {
    const { connectUpstream } = await started();
    const [url, key] = connectUpstream.mock.calls[0] as [string, string];
    expect(key).toBe('dg-key');
    expect(url).toMatch(/^wss:\/\/api\.deepgram\.com\/v1\/listen\?/);
    expect(url).toContain('keyterm=Renny');
    expect(new URL(url).searchParams.get('tag')).toMatch(/^vst-[0-9a-f]{12}$/);
  });

  it('503s when Deepgram does not accept the socket in time', async () => {
    const { client } = await started({}, false);
    await vi.advanceTimersByTimeAsync(UPSTREAM_OPEN_MS);
    expect(client.closed?.code).toBe(4503);
  });
});

describe('runRelay: piping', () => {
  it('holds early audio, then pipes both ways, and ends on the client CloseStream', async () => {
    const made = makeDeps();
    const client = new FakeSocket();
    const done = runRelay(client, session, made.deps);
    client.open();
    // Spoken before Deepgram is connected: held, in order.
    client.receive(new Uint8Array(CHUNK).fill(1).buffer);
    client.receive(new Uint8Array(CHUNK).fill(2).buffer);
    await settle();
    const upstream = made.upstreams[0]!;
    upstream.open();
    expect(client.texts[0]).toMatchObject({ type: 'Ready' });
    expect((upstream.sent[0] as Uint8Array)[0]).toBe(1);
    expect((upstream.sent[1] as Uint8Array)[0]).toBe(2);

    client.receive(audio());
    client.receive(JSON.stringify({ type: 'KeepAlive' }));
    expect(upstream.audioBytes).toBe(3 * CHUNK);
    expect(upstream.texts).toContainEqual({ type: 'KeepAlive' });

    const result = JSON.stringify({ type: 'Results', is_final: true });
    upstream.receive(result);
    expect(client.sent).toContain(result);

    client.receive(JSON.stringify({ type: 'CloseStream' }));
    expect(upstream.texts.at(-1)).toEqual({ type: 'CloseStream' });
    expect(client.closed).toBeNull();
    // Deepgram flushes and closes: the client is closed normally.
    upstream.drop();
    expect(client.closed?.code).toBe(1000);

    const summary = await done;
    expect(summary).toMatchObject({ reason: 'client_done', bytes: 3 * CHUNK, seconds: 0.3 });
    const line = log.mock.calls
      .map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
      .find((l) => l.event === 'stream');
    expect(line).toMatchObject({ fn: 'voice-stream', seconds: 0.3, bytes: 3 * CHUNK });
    expect(line?.profile).toMatch(/^[0-9a-f]{12}$/);
    expect(JSON.stringify(line)).not.toContain(ME);
    expect(made.rpcCalls).toContainEqual({
      name: 'waves_voice_stream_seconds',
      args: { p_profile: ME, p_seconds: 0.3 },
    });
  });

  it('still transcribes a command finished before Deepgram connected', async () => {
    const made = makeDeps();
    const client = new FakeSocket();
    void runRelay(client, session, made.deps);
    client.open();
    client.receive(audio());
    client.receive(JSON.stringify({ type: 'CloseStream' }));
    await settle();
    const upstream = made.upstreams[0]!;
    upstream.open();
    expect(upstream.audioBytes).toBe(CHUNK);
    expect(upstream.texts.at(-1)).toEqual({ type: 'CloseStream' });
  });

  it('closes Deepgram when the client goes away', async () => {
    const { client, upstream, done } = await started();
    client.receive(audio());
    client.drop();
    expect(upstream?.closed).not.toBeNull();
    await expect(done).resolves.toMatchObject({ reason: 'client_closed', bytes: CHUNK });
  });

  it('reports Deepgram closing on its own as a failure (1011)', async () => {
    const { client, upstream } = await started();
    upstream!.drop();
    expect(client.closed?.code).toBe(1011);
  });

  it('does not dial Deepgram for a client that left during the gate', async () => {
    const made = makeDeps();
    const client = new FakeSocket();
    void runRelay(client, session, made.deps);
    client.open();
    client.drop();
    await settle();
    expect(made.connectUpstream).not.toHaveBeenCalled();
  });
});

describe('runRelay: caps', () => {
  it('cuts at 20 s of audio: trims the crossing frame, CloseStream, flush, close', async () => {
    const { client, upstream, done } = await started();
    const frames = Math.floor(MAX_AUDIO_BYTES / CHUNK); // exactly 20 s
    for (let i = 0; i < frames - 1; i++) client.receive(audio());
    client.receive(audio(CHUNK + 1000)); // crosses the cap
    expect(upstream!.audioBytes).toBe(MAX_AUDIO_BYTES);
    expect(upstream!.texts.at(-1)).toEqual({ type: 'CloseStream' });
    client.receive(audio()); // dropped
    expect(upstream!.audioBytes).toBe(MAX_AUDIO_BYTES);
    expect(client.closed).toBeNull();
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    expect(client.closed?.code).toBe(1000);
    expect(upstream!.closed).not.toBeNull();
    await expect(done).resolves.toMatchObject({ reason: 'audio_cap', seconds: 20 });
  });

  it('cuts at 25 s of wall time even when audio trickles in under the caps', async () => {
    const { client, upstream, done } = await started();
    for (let s = 0; s < 24; s++) {
      client.receive(audio());
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(upstream!.texts).not.toContainEqual({ type: 'CloseStream' });
    await vi.advanceTimersByTimeAsync(MAX_WALL_MS - 24_000);
    expect(upstream!.texts.at(-1)).toEqual({ type: 'CloseStream' });
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    expect(client.closed?.code).toBe(1000);
    await expect(done).resolves.toMatchObject({ reason: 'wall_cap' });
  });

  it('holds the wall deadline even if Deepgram ignores CloseStream and the client keeps talking', async () => {
    const { client } = await started();
    await vi.advanceTimersByTimeAsync(MAX_WALL_MS + FLUSH_MS);
    expect(client.closed).not.toBeNull();
  });

  it('cuts after 5 s with no audio frames (KeepAlives do not count)', async () => {
    const { client, upstream, done } = await started();
    client.receive(audio());
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1000);
    client.receive(JSON.stringify({ type: 'KeepAlive' }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(upstream!.texts.at(-1)).toEqual({ type: 'CloseStream' });
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    expect(client.closed?.code).toBe(1000);
    await expect(done).resolves.toMatchObject({ reason: 'idle' });
  });

  it('closes at once (1009) on an oversized frame', async () => {
    const { client, upstream } = await started();
    client.receive(audio(40_000));
    expect(client.closed?.code).toBe(1009);
    expect(upstream!.audioBytes).toBe(0);
  });

  it('closes at once (1008) past 20 s of audio plus the margin, flush or not', async () => {
    const { client, done } = await started();
    const frames = Math.ceil((MAX_AUDIO_BYTES + BYTE_MARGIN) / CHUNK) + 1;
    for (let i = 0; i < frames && !client.closed; i++) client.receive(audio());
    expect(client.closed?.code).toBe(1008);
    const summary: RelaySummary = await done;
    expect(summary.reason).toBe('byte_cap');
    expect(summary.bytes).toBe(MAX_AUDIO_BYTES);
  });
});
