/**
 * voice-stream — the server relay for the app's live transcription.
 *
 * The app opens a WebSocket here instead of straight to Deepgram. The relay
 * checks the caller (the same gate as `voice-stream-token`: signed in, flag /
 * allowlist, rate limit, a peek at the command allowance, one mint from the
 * monthly stream budget), opens the Deepgram socket itself with the server key,
 * and pipes audio up and results down. Because the Deepgram socket is the
 * server's, its life is the server's to end: a modified app can no longer hold a
 * stream open past the session cap (docs/voice-cloud-stt-and-structuring.md
 * §10.1). Every stream ends at whichever comes first:
 *
 *   • 20 s of audio forwarded (`MAX_AUDIO_BYTES`),
 *   • 25 s of wall time since the connect (`MAX_WALL_MS`),
 *   • 5 s without an audio frame (`IDLE_MS`),
 *   • the app sending CloseStream (the person let go of the mic),
 *
 * each by sending Deepgram CloseStream and giving it `FLUSH_MS` to return the
 * last results before both sockets are closed. A hard deadline at
 * `MAX_WALL_MS + FLUSH_MS` closes everything whatever state it is in. A frame
 * over `MAX_FRAME_BYTES`, or more than 20 s of audio plus `BYTE_MARGIN` received
 * in total, closes at once without a flush.
 *
 * Wire protocol (client side in apps/mobile/src/lib/voiceStream.ts):
 *
 *   • Connect: `wss://<project>/functions/v1/voice-stream?locale=en&groupId=…`
 *     with subprotocols `['waves-voice-v1', 'jwt-<supabase access token>']`
 *     (`?access_token=` is accepted too, for clients that cannot set
 *     subprotocols). The gateway's own JWT check is off for this function
 *     (`verify_jwt = false`): browsers and React Native cannot put an
 *     Authorization header on a WebSocket upgrade, so the relay verifies the
 *     token itself (`auth.getUser`) before anything costs money.
 *   • Client → relay: binary 16 kHz mono linear16 PCM; text `{"type":"KeepAlive"}`
 *     and `{"type":"CloseStream"}`. Audio may be sent from the moment the socket
 *     opens; it is held until Deepgram is connected.
 *   • Relay → client: `{"type":"Ready"}` once Deepgram is connected, then
 *     Deepgram's own messages verbatim. A refusal is `{"type":"Error", status,
 *     code}` followed by a close with code `4000 + status` (4401, 4402, 4429,
 *     4503) — a WebSocket client cannot read an HTTP status, so the status
 *     travels in the close code.
 *
 * Each stream logs `{profile: sha256(id)[0..12], seconds, bytes, reason}` and
 * adds its seconds to `voice_agent_usage.stream_seconds`.
 */

import { HttpError, json, type SupabaseClient } from '../_shared/auth.ts';
import { CircuitBreaker, raceDeadline } from '../_shared/resilience.ts';
import { chaosFor, NO_CHAOS, type Chaos } from '../_shared/voiceChaos.ts';
import { admitStream, type Admitted } from '../_shared/voiceStreamGate.ts';
import { loadContext } from '../voice-agent/handler.ts';
import { deepgramStreamUrl, keyterms } from '../voice-agent/logic.ts';

/** The subprotocol the app offers and the relay selects. */
export const RELAY_PROTOCOL = 'waves-voice-v1';
/** A subprotocol carrying the caller's JWT (the Supabase-documented shape). */
export const JWT_PROTOCOL_PREFIX = 'jwt-';

/** 16 kHz mono 16-bit PCM. */
export const BYTES_PER_SECOND = 32_000;
export const MAX_AUDIO_SECONDS = 20;
export const MAX_AUDIO_BYTES = MAX_AUDIO_SECONDS * BYTES_PER_SECOND;
/** Received beyond the forwarded cap before the client is cut off outright. */
export const BYTE_MARGIN = 2 * BYTES_PER_SECOND;
/** The app sends 100 ms chunks (3.2 kB); one second is plenty of headroom. */
export const MAX_FRAME_BYTES = BYTES_PER_SECOND;
/** Text frames are only KeepAlive / CloseStream. */
export const MAX_TEXT_BYTES = 256;
export const MAX_WALL_MS = 25_000;
export const IDLE_MS = 5_000;
export const FLUSH_MS = 1_500;
/** How long Deepgram may take to accept the upstream socket. */
export const UPSTREAM_OPEN_MS = 4_000;
/**
 * How long the stream waits on the caller's names (keyterms). They only help
 * spelling: a slow database must not hold the stream, so past this it opens
 * without them.
 */
export const CONTEXT_WAIT_MS = 1_500;
/** `relay-drop` chaos: how long after Ready the relay cuts the stream. */
export const CHAOS_DROP_MS = 1_000;

/**
 * Deepgram's live endpoint, per warm instance: after 3 failed upstream connects
 * in a row the relay refuses at once (503) for 60 s, so the app falls back to
 * on-device in one round trip instead of waiting out a 4 s connect each time.
 */
export const upstreamBreaker = new CircuitBreaker();
const DEEPGRAM = 'deepgram-live';

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

/** The slice of a WebSocket the relay uses — Deno's, Deepgram's, or a test double. */
export interface RelaySocket {
  readonly readyState: number;
  binaryType: string;
  send(data: string | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface RelayDeps {
  readonly env: (name: string) => string | undefined;
  readonly service: SupabaseClient;
  /** A client acting as the caller (RLS applies), from their access token. */
  readonly callerFor: (jwt: string) => SupabaseClient;
  readonly rateLimit: (profileId: string) => Promise<void>;
  /** `Deno.upgradeWebSocket`, selecting `protocol` when one is given. */
  readonly upgrade: (
    request: Request,
    protocol: string | undefined,
  ) => { socket: RelaySocket; response: Response };
  /** Open the Deepgram socket with the server key. */
  readonly connectUpstream: (url: string, key: string) => RelaySocket;
  /** Keep the worker alive until the relay is done (`EdgeRuntime.waitUntil`). */
  readonly waitUntil: (work: Promise<unknown>) => void;
}

export interface RelaySession {
  readonly jwt: string;
  readonly locale: string;
  readonly groupId: string | null;
}

/** What one stream cost, for the log and the meter. */
export interface RelaySummary {
  readonly reason: string;
  readonly seconds: number;
  readonly bytes: number;
  readonly received: number;
  readonly wallMs: number;
  readonly profile: string | null;
}

/** The caller's JWT from the subprotocols, else `?access_token=` / `?jwt=`. */
export function readCredentials(request: Request): {
  jwt: string | null;
  protocol: string | undefined;
} {
  const offered = (request.headers.get('sec-websocket-protocol') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const fromProtocol = offered.find((value) => value.startsWith(JWT_PROTOCOL_PREFIX));
  const url = new URL(request.url);
  const jwt =
    (fromProtocol ? fromProtocol.slice(JWT_PROTOCOL_PREFIX.length) : null) ||
    url.searchParams.get('access_token') ||
    url.searchParams.get('jwt') ||
    null;
  // A browser fails the handshake unless the server selects one of the offered
  // subprotocols, so one is always echoed when any was offered — ours by
  // preference, never the one carrying the token.
  const protocol = offered.includes(RELAY_PROTOCOL)
    ? RELAY_PROTOCOL
    : (offered.find((value) => !value.startsWith(JWT_PROTOCOL_PREFIX)) ?? fromProtocol);
  return { jwt, protocol };
}

const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const GROUP_ID = /^[0-9A-Za-z-]{1,64}$/;

export function handleVoiceStream(request: Request, deps: RelayDeps): Response {
  if ((request.headers.get('upgrade') ?? '').toLowerCase() !== 'websocket') {
    return json({ code: 'UPGRADE_REQUIRED', message: 'Connect with a WebSocket' }, 426, {
      Upgrade: 'websocket',
    });
  }
  const { jwt, protocol } = readCredentials(request);
  // Refused before the upgrade: no token, no socket.
  if (!jwt) return json({ code: 'NOT_AUTHENTICATED', message: 'Sign in first' }, 401);

  const params = new URL(request.url).searchParams;
  const rawLocale = params.get('locale') ?? '';
  const rawGroup = params.get('groupId') ?? '';
  const session: RelaySession = {
    jwt,
    locale: rawLocale.length <= 24 && LOCALE.test(rawLocale) ? rawLocale : 'en',
    groupId: GROUP_ID.test(rawGroup) ? rawGroup : null,
  };

  const { socket, response } = deps.upgrade(request, protocol);
  deps.waitUntil(runRelay(socket, session, deps));
  return response;
}

/** A WebSocket close code for a refusal: 4000 + the HTTP status. */
export function closeCodeFor(status: number): number {
  return status >= 400 && status <= 599 ? 4000 + status : 4500;
}

function asBytes(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data))
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

/**
 * Run one relayed stream on an upgraded client socket. Resolves once both
 * sockets are closed and the stream is logged and metered; never rejects.
 */
export function runRelay(
  client: RelaySocket,
  session: RelaySession,
  deps: RelayDeps,
): Promise<RelaySummary> {
  client.binaryType = 'arraybuffer';
  const startedAt = Date.now();

  let received = 0;
  let forwarded = 0;
  let admitted: Admitted | null = null;
  let upstream: RelaySocket | null = null;
  let upstreamOpen = false;
  /** Audio heard before Deepgram is connected, in order. */
  const pending: Uint8Array[] = [];
  /** Messages for the client before its socket finished opening. */
  const outbox: string[] = [];
  /** Why the stream is ending, once it is (the flush is in progress). */
  let closing: string | null = null;
  let flushing = false;
  let finished = false;

  const timers = new Set<ReturnType<typeof setTimeout>>();
  const after = (ms: number, run: () => void): ReturnType<typeof setTimeout> => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, ms);
    timers.add(timer);
    return timer;
  };
  const cancel = (timer: ReturnType<typeof setTimeout> | null): void => {
    if (timer === null) return;
    clearTimeout(timer);
    timers.delete(timer);
  };

  let resolveDone: (summary: RelaySummary) => void = () => {};
  const done = new Promise<RelaySummary>((resolve) => {
    resolveDone = resolve;
  });

  const sendClient = (message: string): void => {
    if (client.readyState === OPEN) {
      try {
        client.send(message);
      } catch {
        // The client is going; its close handler finishes the stream.
      }
    } else if (client.readyState < OPEN) outbox.push(message);
  };

  const sendUpstream = (data: string | Uint8Array): void => {
    if (!upstream || !upstreamOpen) return;
    try {
      upstream.send(data);
    } catch {
      // Deepgram is going; its close handler finishes the stream.
    }
  };

  let closeOnOpen: { code: number; reason: string } | null = null;
  const closeClient = (code: number, reason: string): void => {
    try {
      if (client.readyState !== CLOSED) client.close(code, reason.slice(0, 120));
    } catch {
      // Already gone.
    }
  };

  const finish = (reason: string, code = 1000): void => {
    if (finished) return;
    finished = true;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    pending.length = 0;
    try {
      if (upstream && upstream.readyState !== CLOSED) upstream.close(1000);
    } catch {
      // Already gone.
    }
    // A client still opening is closed once it opens, after the outbox (which
    // may hold the refusal) — closing a socket mid-handshake would drop it.
    if (client.readyState === CONNECTING) closeOnOpen = { code, reason };
    else closeClient(code, reason);
    const summary: RelaySummary = {
      reason,
      seconds: Math.round((forwarded / BYTES_PER_SECOND) * 100) / 100,
      bytes: forwarded,
      received,
      wallMs: Date.now() - startedAt,
      profile: admitted?.profileHash ?? null,
    };
    void settle(summary).then(() => resolveDone(summary));
  };

  /** Log the stream and add its seconds to the month's meter. */
  const settle = async (summary: RelaySummary): Promise<void> => {
    console.log(JSON.stringify({ fn: 'voice-stream', event: 'stream', ...summary }));
    if (!admitted || summary.bytes === 0) return;
    try {
      const { error } = await deps.service.rpc('waves_voice_stream_seconds', {
        p_profile: admitted.profileId,
        p_seconds: summary.seconds,
      });
      if (error) console.error('stream seconds not recorded', error.message);
    } catch (error) {
      console.error('stream seconds not recorded', String(error));
    }
  };

  /** CloseStream to Deepgram, then at most FLUSH_MS for its last results. */
  const startFlush = (): void => {
    if (flushing || finished) return;
    flushing = true;
    sendUpstream(JSON.stringify({ type: 'CloseStream' }));
    after(FLUSH_MS, () => finish(closing ?? 'flushed'));
  };

  /** End the stream, letting Deepgram finish what it has heard. */
  const endGracefully = (reason: string): void => {
    if (finished || closing) return;
    closing = reason;
    cancel(idleTimer);
    idleTimer = null;
    if (upstreamOpen) startFlush();
    // Not connected yet: the app's own CloseStream (a short command) still
    // waits for Deepgram, so the held audio is transcribed; anything else
    // ending before then had nothing worth flushing.
    else if (reason !== 'client_done') finish(reason);
  };

  const forward = (bytes: Uint8Array): void => {
    const room = MAX_AUDIO_BYTES - forwarded;
    if (room <= 0) return endGracefully('audio_cap');
    const chunk = bytes.byteLength > room ? bytes.subarray(0, room) : bytes;
    sendUpstream(chunk);
    forwarded += chunk.byteLength;
    if (forwarded >= MAX_AUDIO_BYTES) endGracefully('audio_cap');
  };

  // The caps that hold whatever the client does.
  after(MAX_WALL_MS, () => endGracefully('wall_cap'));
  after(MAX_WALL_MS + FLUSH_MS, () => finish(closing ?? 'wall_cap'));
  let idleTimer: ReturnType<typeof setTimeout> | null = after(IDLE_MS, () => endGracefully('idle'));

  client.onopen = () => {
    for (const message of outbox.splice(0)) sendClient(message);
    if (closeOnOpen) closeClient(closeOnOpen.code, closeOnOpen.reason);
  };
  client.onerror = () => {};
  client.onclose = () => {
    // The app is gone: nobody is left to read a flush.
    finish(closing ?? 'client_closed');
  };
  client.onmessage = (event) => {
    if (finished) return;
    const { data } = event;
    if (typeof data === 'string') {
      if (data.length > MAX_TEXT_BYTES) return finish('frame_too_big', 1009);
      let type: unknown;
      try {
        type = (JSON.parse(data) as { type?: unknown } | null)?.type;
      } catch {
        return;
      }
      if (type === 'KeepAlive' && !closing) sendUpstream(data);
      else if (type === 'CloseStream') endGracefully('client_done');
      return;
    }
    const bytes = asBytes(data);
    if (!bytes) return;
    if (bytes.byteLength > MAX_FRAME_BYTES) return finish('frame_too_big', 1009);
    received += bytes.byteLength;
    if (received > MAX_AUDIO_BYTES + BYTE_MARGIN) return finish('byte_cap', 1008);
    if (closing || bytes.byteLength === 0) return;
    cancel(idleTimer);
    idleTimer = after(IDLE_MS, () => endGracefully('idle'));
    if (upstreamOpen) forward(bytes);
    else pending.push(bytes);
  };

  const refuse = (error: unknown): void => {
    const status = error instanceof HttpError ? error.status : 500;
    const code = error instanceof HttpError ? error.code : 'INTERNAL';
    if (!(error instanceof HttpError)) console.error('voice-stream gate failed', String(error));
    sendClient(JSON.stringify({ type: 'Error', status, code }));
    finish(code, closeCodeFor(status));
  };

  /** The upstream never came up (refused, closed, timed out): counted, then refused. */
  const upstreamFailed = (message: string): void => {
    upstreamBreaker.failure(DEEPGRAM);
    refuse(new HttpError(503, 'VOICE_AGENT_UNAVAILABLE', message));
  };

  const connect = async (): Promise<void> => {
    // Deepgram has been failing on this instance: refuse before anything is
    // spent (no mint, no context read). The app listens on the phone.
    if (upstreamBreaker.isOpen(DEEPGRAM)) {
      return refuse(new HttpError(503, 'VOICE_AGENT_UNAVAILABLE', 'Live transcription down'));
    }
    const caller = deps.callerFor(session.jwt);
    try {
      admitted = await admitStream(
        { env: deps.env, caller, service: deps.service, rateLimit: deps.rateLimit },
        'voice-stream',
      );
    } catch (error) {
      return refuse(error);
    }
    if (finished) return;

    const [context, chaos] = await Promise.all([
      raceDeadline(
        loadContext(caller, admitted.profileId, {
          schemaVersion: 1,
          locale: session.locale,
          today: new Date().toISOString().slice(0, 10),
          groupId: session.groupId,
        }),
        CONTEXT_WAIT_MS,
        () => new Error('context timed out'),
      ).catch(() => null),
      // Failure drills on allowlisted accounts only (_shared/voiceChaos.ts).
      chaosFor(deps.env, deps.service, admitted.profileId).catch((): Chaos => NO_CHAOS),
    ]);
    if (finished) return;
    if (chaos.has('deepgram-down')) return upstreamFailed('Live transcription down (chaos)');
    const url = deepgramStreamUrl(
      session.locale,
      context ? keyterms(context) : [],
      `vst-${admitted.profileHash}`,
    );

    const openTimer = after(UPSTREAM_OPEN_MS, () => upstreamFailed('Live transcription timed out'));
    // `deepgram-slow`: the upstream never answers; the open timer above ends it.
    if (chaos.has('deepgram-slow')) return;
    let socket: RelaySocket;
    try {
      socket = deps.connectUpstream(url, admitted.key);
    } catch (error) {
      cancel(openTimer);
      console.error('deepgram connect failed', String(error));
      return upstreamFailed('Live transcription down');
    }
    upstream = socket;
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => {
      cancel(openTimer);
      if (finished) return;
      upstreamOpen = true;
      upstreamBreaker.success(DEEPGRAM);
      sendClient(JSON.stringify({ type: 'Ready', maxAudioSeconds: MAX_AUDIO_SECONDS }));
      // `relay-drop`: the stream dies mid-sentence, as a dropped Deepgram socket would.
      if (chaos.has('relay-drop')) after(CHAOS_DROP_MS, () => finish('chaos_drop', 1011));
      for (const bytes of pending.splice(0)) {
        if (forwarded >= MAX_AUDIO_BYTES) break;
        forward(bytes);
      }
      if (closing) startFlush();
    };
    socket.onmessage = (event) => {
      if (finished) return;
      if (typeof event.data === 'string') sendClient(event.data);
    };
    socket.onerror = () => {};
    socket.onclose = () => {
      cancel(openTimer);
      if (finished) return;
      if (!upstreamOpen) return upstreamFailed('Live transcription down');
      // Deepgram closing after CloseStream is the normal end; on its own, it
      // is a failure the app should hear as one.
      finish(closing ?? 'upstream_closed', closing ? 1000 : 1011);
    };
  };

  connect().catch(refuse);
  return done;
}
