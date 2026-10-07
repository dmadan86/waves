/**
 * Live transcription for the advanced voice (Pro): the mic streams raw 16 kHz
 * mono PCM straight to Deepgram over a WebSocket, and interim words come back
 * while the person is still speaking. Only the final text goes on to the
 * `voice-agent` function. A short-lived token (from `voice-stream-token`) is the
 * socket's credential, so no long-lived key ever reaches the phone.
 *
 * The mic starts on the press ({@link startCapture}) and buffers; the socket is
 * attached once the entitlement and token are in ({@link attachStream}), and the
 * buffered start of the sentence goes first — so the first words are not lost
 * to the round trips. A fallback to on-device discards the capture.
 *
 * Every failure here is a typed "no" the caller answers with the on-device
 * recogniser — this module never throws into the UI.
 */

import type { VoiceStreamTokenRequest, VoiceStreamTokenResponse } from '@waves/core';

import * as Network from 'expo-network';

import { backend } from '@/lib/backend';
import { isOnline, STREAM_MAX_SESSION_MS } from '@/lib/voiceEnginePure';
import {
  applyMessage,
  base64ToBytes,
  EMPTY_TRANSCRIPT,
  fullText,
  liveText,
  pcmLevel,
  streamAlternatives,
  createPcmBuffer,
  PCM_BYTES_PER_SECOND,
  streamTokenFailure,
  type PcmBuffer,
  type StreamTokenFailure,
  type TranscriptState,
} from '@/lib/voiceStreamPure';

/** A token for the stream, or why there is none (`quota`: the month is spent). */
export type StreamTokenResult =
  { kind: 'ok'; token: VoiceStreamTokenResponse } | { kind: StreamTokenFailure };

/** How long stop() waits for Deepgram's last results after CloseStream. */
const FLUSH_TIMEOUT_MS = 1500;
/** How long the socket may take to open before the stream is given up on. */
const OPEN_TIMEOUT_MS = 4000;
/** Send a KeepAlive when no audio has gone out for this long. */
const KEEPALIVE_AFTER_MS = 4000;

/**
 * A token fetched ahead — when the voice screen opens — so pressing the mic
 * starts listening at once instead of after a server round trip (otherwise the
 * first words of a sentence spoken straight away would fall into that gap). A
 * token only has to be valid when the socket opens; one is reused for
 * `TOKEN_REUSE_MS` and then fetched afresh.
 */
const TOKEN_REUSE_MS = 40_000;
let ahead: {
  key: string;
  at: number;
  value: Promise<StreamTokenResult>;
} | null = null;

const tokenKey = (request: VoiceStreamTokenRequest): string =>
  `${request.groupId ?? ''}|${request.locale}`;

/** Whether the phone has a connection right now. Unknown reads as online. */
export async function checkOnline(): Promise<boolean> {
  try {
    return isOnline(await Network.getNetworkStateAsync());
  } catch {
    return true;
  }
}

/** Start fetching a token now, for a mic press that is likely to follow. */
export function prefetchStreamToken(request: VoiceStreamTokenRequest): void {
  const key = tokenKey(request);
  if (ahead && ahead.key === key && Date.now() - ahead.at < TOKEN_REUSE_MS) return;
  ahead = { key, at: Date.now(), value: fetchStreamToken(request) };
}

/**
 * A token for this press: the one fetched ahead if still fresh, else a new one.
 * A prefetch that hit the monthly limit is the answer too (no second round trip
 * to hear the same 402); any other prefetch failure is retried once here.
 */
export async function getStreamToken(request: VoiceStreamTokenRequest): Promise<StreamTokenResult> {
  const key = tokenKey(request);
  if (ahead && ahead.key === key && Date.now() - ahead.at < TOKEN_REUSE_MS) {
    const held = ahead;
    // One use: the next press fetches its own (or the next prefetch does).
    ahead = null;
    const value = await held.value;
    if (value.kind !== 'error') return value;
  }
  return fetchStreamToken(request);
}

/** The HTTP status behind a `functions.invoke` error, the way voiceAgent reads it. */
function errorStatus(error: unknown): number | null {
  const response = (error as { context?: unknown } | null)?.context;
  if (typeof Response !== 'undefined' && response instanceof Response) return response.status;
  const status = (response as { status?: unknown } | null | undefined)?.status;
  return typeof status === 'number' ? status : null;
}

async function fetchStreamToken(request: VoiceStreamTokenRequest): Promise<StreamTokenResult> {
  try {
    const { data, error } = await backend.functions.invoke('voice-stream-token', {
      body: request,
    });
    if (error) return { kind: streamTokenFailure(errorStatus(error)) };
    const value = data as Partial<VoiceStreamTokenResponse> | null;
    if (!value || typeof value.token !== 'string' || typeof value.url !== 'string') {
      return { kind: 'error' };
    }
    return { kind: 'ok', token: value as VoiceStreamTokenResponse };
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

/**
 * Open the socket for a running capture: everything heard since the press goes
 * first, in order, then the mic streams live. Resolves once the socket is open,
 * or null if it would not open — the capture is then still the caller's, to
 * discard before the on-device recogniser starts.
 */
export async function attachStream(
  mic: MicCapture,
  session: Pick<VoiceStreamTokenResponse, 'token' | 'url'>,
  handlers: LiveTranscriptionHandlers,
): Promise<LiveTranscription | null> {
  const capture = mic as CaptureInternals;
  if (!capture.isLive()) return null;

  let state: TranscriptState = EMPTY_TRANSCRIPT;
  let socket: WebSocket;
  try {
    socket = new WebSocket(session.url, ['bearer', session.token]);
  } catch {
    return null;
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
  let settleOpen: (ok: boolean) => void = () => {};
  const opened = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), OPEN_TIMEOUT_MS);
    settleOpen = (ok) => {
      clearTimeout(timer);
      resolve(ok);
    };
    socket.onopen = () => {
      isOpen = true;
      lastSent = Date.now();
      resolve(true);
    };
  });

  socket.onmessage = (event: { data: unknown }) => {
    const before = state.finals.length;
    state = applyMessage(state, event.data);
    if (state.finals.length > before) handlers.onFinal(fullText({ ...state, interim: '' }));
    handlers.onInterim(liveText(state));
  };

  // A socket error always ends in a close; that handler does the reporting.
  socket.onerror = () => {};
  socket.onclose = () => {
    closed = true;
    isOpen = false;
    settleOpen(false);
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

  if (!(await opened) || closed) {
    // The capture stays the caller's; only the socket is ours to close.
    clearInterval(keepAlive);
    closeSocket();
    return null;
  }
  // The buffered start of the sentence first, in order, then live.
  capture.buffer.attach(send);
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
  return handle;
}
