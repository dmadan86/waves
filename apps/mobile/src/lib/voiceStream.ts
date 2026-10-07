/**
 * Live transcription for the advanced voice (Pro): the mic streams raw 16 kHz
 * mono PCM over a WebSocket to the `voice-stream` relay, which forwards it to
 * Deepgram, and interim words come back while the person is still speaking.
 * Only the final text goes on to the `voice-agent` function. The socket is
 * authenticated with the signed-in user's own access token; the Deepgram key
 * stays on the server, and so does the session cap (20 s of audio, 25 s of wall
 * time, 5 s idle) — the relay closes the stream itself, whatever this client
 * does. The caps below are kept too, so a normal session ends here first.
 *
 * Builds before the relay fetched a 60 s Deepgram token from
 * `voice-stream-token` and opened Deepgram directly; that function stays
 * deployed for them, unused by this code.
 *
 * The mic starts on the press ({@link startCapture}) and buffers; the socket is
 * attached once the entitlement is in ({@link attachStream}), and the buffered
 * start of the sentence goes first — so the first words are not lost to the
 * round trips. A fallback to on-device discards the capture.
 *
 * Every failure here is a typed "no" the caller answers with the on-device
 * recogniser — this module never throws into the UI.
 */

import type { VoiceStreamTokenRequest } from '@waves/core';

import * as Network from 'expo-network';

import { backend, functionsUrl } from '@/lib/backend';
import { isOnline, STREAM_MAX_SESSION_MS } from '@/lib/voiceEnginePure';
import {
  applyMessage,
  base64ToBytes,
  EMPTY_TRANSCRIPT,
  fullText,
  isRelayReady,
  liveText,
  pcmLevel,
  relayCloseFailure,
  relayProtocols,
  relayStreamUrl,
  streamAlternatives,
  createPcmBuffer,
  PCM_BYTES_PER_SECOND,
  type PcmBuffer,
  type StreamTokenFailure,
  type TranscriptState,
} from '@/lib/voiceStreamPure';

/** Where to open the relay socket and with which subprotocols (one carries the JWT). */
export interface StreamSession {
  readonly url: string;
  readonly protocols: string[];
}

/** A session for the stream, or why there is none. */
export type StreamSessionResult =
  { kind: 'ok'; session: StreamSession } | { kind: StreamTokenFailure };

/** How long stop() waits for Deepgram's last results after CloseStream. */
const FLUSH_TIMEOUT_MS = 1500;
/**
 * How long the relay's WebSocket may take to open at all. A relay that cannot
 * even be reached (offline mid-press, a cold or failing function) is given up
 * on here, and the person is moved to the on-device recogniser.
 */
export const SOCKET_OPEN_TIMEOUT_MS = 4000;
/**
 * How long the relay may take to say Ready, from the press of the socket: its
 * auth and budget checks plus its own connect to Deepgram (which it gives 4 s
 * and then refuses with 4503).
 */
export const OPEN_TIMEOUT_MS = 6000;
/** Send a KeepAlive when no audio has gone out for this long. */
const KEEPALIVE_AFTER_MS = 4000;

/** Whether the phone has a connection right now. Unknown reads as online. */
export async function checkOnline(): Promise<boolean> {
  try {
    return isOnline(await Network.getNetworkStateAsync());
  } catch {
    return true;
  }
}

/**
 * The relay URL and credentials for this press. The access token comes from the
 * stored session (refreshed by the client when it has expired); no round trip
 * to a function. Whether the stream is allowed — flag, monthly limit, stream
 * budget — is the relay's answer when the socket opens ({@link attachStream}).
 */
export async function getStreamSession(
  request: VoiceStreamTokenRequest,
): Promise<StreamSessionResult> {
  if (!functionsUrl) return { kind: 'error' };
  try {
    const { data } = await backend.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { kind: 'error' };
    return {
      kind: 'ok',
      session: { url: relayStreamUrl(functionsUrl, request), protocols: relayProtocols(token) },
    };
  } catch {
    return { kind: 'error' };
  }
}

export interface LiveTranscriptionHandlers {
  /** The whole sentence so far (finals plus the live tail). */
  onInterim: (text: string) => void;
  /** A segment was finalised; the text is everything finalised so far. */
  onFinal: (text: string) => void;
  /** The stream died mid-way (socket error/close). */
  onError: () => void;
}

export interface LiveTranscription {
  /** Stop the mic, flush Deepgram and return the full transcript. */
  stop: () => Promise<string>;
  /** Drop everything without a transcript. */
  cancel: () => void;
  /**
   * The stream's other whole-sentence hypotheses so far (from Deepgram's
   * `channel.alternatives[1..]`), best first — empty when it sent only one.
   */
  alternatives: () => string[];
}

interface AudioModule {
  startRecording: (config: Record<string, unknown>) => Promise<unknown>;
  stopRecording: () => Promise<unknown>;
  addListener: (
    name: string,
    listener: (event: { encoded?: string; deltaSize?: number }) => void,
  ) => { remove: () => void };
}

function loadAudioModule(): AudioModule | null {
  try {
    // Required lazily: a binary built before the native module existed throws on
    // import, and that must read as "no streaming", not a crashed route.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const studio = require('@siteed/audio-studio') as { AudioStudioModule: AudioModule };
    return studio.AudioStudioModule ?? null;
  } catch {
    return null;
  }
}

/** Whether this build can stream the mic at all. */
export function streamingAvailable(): boolean {
  return loadAudioModule() !== null;
}

/** The single owner of the recorder: a buffering capture or a live stream. */
let active: { cancel: () => void } | null = null;

/** Release the recorder from whoever holds it (a new capture is starting). */
function takeRecorder(): void {
  if (active) {
    const previous = active;
    active = null;
    previous.cancel();
  }
}

export interface CaptureHandlers {
  /** Input loudness 0…1 per chunk, for the waveform. */
  onLevel?: (level: number) => void;
}

/**
 * The mic, recording from the press. Audio is held in memory (up to one whole
 * session, {@link STREAM_MAX_SESSION_MS}) until {@link attachStream} hands it to
 * a socket, or {@link MicCapture.discard} drops it for the on-device recogniser.
 */
export interface MicCapture {
  /** When the recorder reported started (ms since epoch). */
  readonly startedAt: number;
  /** Stop the recorder and drop everything held. Resolves once the mic is free. */
  discard: () => Promise<void>;
}

interface CaptureInternals extends MicCapture {
  readonly buffer: PcmBuffer<ArrayBuffer>;
  /** Stop the recorder, keeping whatever was already forwarded. */
  stopRecorder: () => Promise<void>;
  isLive: () => boolean;
}

const BUFFER_MAX_BYTES = Math.ceil((STREAM_MAX_SESSION_MS / 1000) * PCM_BYTES_PER_SECOND);

/**
 * Start the recorder now and buffer what it hears. Resolves once the native
 * recorder reports started, or null if it could not start (nothing left open).
 * One recording in the app at a time: a new capture ends the previous one.
 */
export async function startCapture(handlers: CaptureHandlers = {}): Promise<MicCapture | null> {
  const audio = loadAudioModule();
  if (!audio) return null;
  // The recorder is a single native instance, so a second start silently
  // replaced the first's recording and left a handle whose stop no longer
  // reached it. A new start ends the previous one first.
  takeRecorder();

  const buffer = createPcmBuffer<ArrayBuffer>(BUFFER_MAX_BYTES);
  let subscription: { remove: () => void } | null = null;
  let recording = false;
  let stopping: Promise<void> | null = null;

  const stopRecorder = (): Promise<void> => {
    if (stopping) return stopping;
    subscription?.remove();
    subscription = null;
    if (!recording) return (stopping = Promise.resolve());
    recording = false;
    stopping = Promise.resolve(audio.stopRecording()).then(
      () => undefined,
      () => undefined,
    );
    return stopping;
  };

  try {
    subscription = audio.addListener('AudioData', (event) => {
      if (!event.encoded || event.deltaSize === 0) return;
      const bytes = base64ToBytes(event.encoded);
      if (bytes.length === 0) return;
      handlers.onLevel?.(pcmLevel(bytes));
      buffer.push(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      );
    });
    await audio.startRecording({
      sampleRate: 16000,
      channels: 1,
      encoding: 'pcm_16bit',
      interval: 100,
      // Streaming only: no file is written.
      output: { primary: { enabled: false } },
    });
    recording = true;
  } catch {
    buffer.discard();
    await stopRecorder();
    return null;
  }

  const capture: CaptureInternals = {
    startedAt: Date.now(),
    buffer,
    stopRecorder,
    isLive: () => recording,
    discard: async () => {
      if (active === owner) active = null;
      buffer.discard();
      await stopRecorder();
    },
  };
  const owner = { cancel: () => void capture.discard() };
  active = owner;
  return capture;
}

/** The live stream, or why it would not start (`quota`: the relay answered 402). */
export type AttachResult = { kind: 'ok'; live: LiveTranscription } | { kind: StreamTokenFailure };

/**
 * Open the relay socket for a running capture: everything heard since the press
 * goes first, in order, then the mic streams live. Resolves once the relay says
 * Deepgram is connected, or with why not — the capture is then still the
 * caller's, to discard before the on-device recogniser starts.
 */
export async function attachStream(
  mic: MicCapture,
  session: StreamSession,
  handlers: LiveTranscriptionHandlers,
): Promise<AttachResult> {
  const capture = mic as CaptureInternals;
  if (!capture.isLive()) return { kind: 'error' };

  let state: TranscriptState = EMPTY_TRANSCRIPT;
  let socket: WebSocket;
  try {
    socket = new WebSocket(session.url, session.protocols);
  } catch {
    return { kind: 'error' };
  }
  socket.binaryType = 'arraybuffer';

  let isOpen = false;
  let closed = false;
  let finished = false;
  let lastSent = Date.now();
  let onClosed: (() => void) | null = null;

  const send = (buffer: ArrayBuffer): void => {
    if (!isOpen) return;
    try {
      socket.send(buffer);
      lastSent = Date.now();
    } catch {
      // A send on a dying socket — the close/error handler reports it.
    }
  };

  let ready = false;
  let settleOpen: (result: 'ready' | StreamTokenFailure) => void = () => {};
  const opened = new Promise<'ready' | StreamTokenFailure>((resolve) => {
    const timer = setTimeout(() => resolve('error'), OPEN_TIMEOUT_MS);
    const socketTimer = setTimeout(() => resolve('error'), SOCKET_OPEN_TIMEOUT_MS);
    settleOpen = (result) => {
      clearTimeout(timer);
      clearTimeout(socketTimer);
      resolve(result);
    };
    socket.onopen = () => {
      clearTimeout(socketTimer);
      isOpen = true;
      lastSent = Date.now();
      // The buffered start of the sentence goes now, in order, then live: the
      // relay holds it while it checks the caller and connects to Deepgram.
      capture.buffer.attach(send);
    };
  });

  socket.onmessage = (event: { data: unknown }) => {
    if (!ready && isRelayReady(event.data)) {
      settleOpen('ready');
      return;
    }
    const before = state.finals.length;
    state = applyMessage(state, event.data);
    if (state.finals.length > before) handlers.onFinal(fullText({ ...state, interim: '' }));
    handlers.onInterim(liveText(state));
  };

  // A socket error always ends in a close; that handler does the reporting.
  socket.onerror = () => {};
  socket.onclose = (event: { code?: number }) => {
    closed = true;
    isOpen = false;
    // Closed before Ready: a refusal (4000 + status) or a failed connection.
    settleOpen(relayCloseFailure(event?.code));
    onClosed?.();
    // Closing on its own, once running and before stop() or cancel(), is a
    // failure to report. (Failing to open is reported by the null result.)
    if (ready && !finished) {
      finished = true;
      stopAll();
      handlers.onError();
    }
  };
  const keepAlive = setInterval(() => {
    if (isOpen && Date.now() - lastSent > KEEPALIVE_AFTER_MS) {
      try {
        socket.send(JSON.stringify({ type: 'KeepAlive' }));
        lastSent = Date.now();
      } catch {
        // See send().
      }
    }
  }, 2000);

  function stopAll(): void {
    clearInterval(keepAlive);
    void capture.discard();
  }
  const closeSocket = (): void => {
    try {
      socket.close();
    } catch {
      // Already gone.
    }
  };

  const outcome = await opened;
  if (outcome !== 'ready' || closed) {
    // The capture stays the caller's; only the socket is ours to close.
    clearInterval(keepAlive);
    isOpen = false;
    closeSocket();
    return { kind: outcome === 'ready' ? 'error' : outcome };
  }
  ready = true;

  const handle: LiveTranscription = {
    stop: async () => {
      if (active === handle) active = null;
      if (finished) return fullText(state);
      finished = true;
      clearInterval(keepAlive);
      // Stop the mic (every chunk already went to the socket), then flush.
      await capture.stopRecorder();
      capture.buffer.discard();
      if (!closed) {
        const flushed = new Promise<void>((resolve) => {
          onClosed = resolve;
          setTimeout(resolve, FLUSH_TIMEOUT_MS);
        });
        try {
          socket.send(JSON.stringify({ type: 'CloseStream' }));
        } catch {
          // Closed under us — nothing more to wait for.
          onClosed?.();
        }
        await flushed;
        closeSocket();
      }
      return fullText(state);
    },
    alternatives: () => streamAlternatives(state),
    cancel: () => {
      if (active === handle) active = null;
      if (finished) return;
      finished = true;
      stopAll();
      closeSocket();
    },
  };
  active = handle;
  return { kind: 'ok', live: handle };
}
