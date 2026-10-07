/**
 * Live transcription for the advanced voice (Pro): the mic streams raw 16 kHz
 * mono PCM straight to Deepgram over a WebSocket, and interim words come back
 * while the person is still speaking. Only the final text goes on to the
 * `voice-agent` function. A short-lived token (from `voice-stream-token`) is the
 * socket's credential, so no long-lived key ever reaches the phone.
 *
 * Every failure here is a typed "no" the caller answers with the on-device
 * recogniser — this module never throws into the UI.
 */

import type { VoiceStreamTokenRequest, VoiceStreamTokenResponse } from '@waves/core';

import * as Network from 'expo-network';

import { backend } from '@/lib/backend';
import { isOnline } from '@/lib/voiceEnginePure';
import {
  applyMessage,
  base64ToBytes,
  EMPTY_TRANSCRIPT,
  fullText,
  liveText,
  pcmLevel,
  type TranscriptState,
} from '@/lib/voiceStreamPure';

/** How long stop() waits for Deepgram's last results after CloseStream. */
const FLUSH_TIMEOUT_MS = 1500;
/** How long the socket may take to open before the stream is given up on. */
const OPEN_TIMEOUT_MS = 4000;
/** Send a KeepAlive when no audio has gone out for this long. */
const KEEPALIVE_AFTER_MS = 4000;
/** Audio held back while the socket is still opening (~100 ms chunks). */
const MAX_PENDING_CHUNKS = 100;

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
  value: Promise<VoiceStreamTokenResponse | null>;
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

/** A token for this press: the one fetched ahead if still fresh, else a new one. */
export async function getStreamToken(
  request: VoiceStreamTokenRequest,
): Promise<VoiceStreamTokenResponse | null> {
  const key = tokenKey(request);
  if (ahead && ahead.key === key && Date.now() - ahead.at < TOKEN_REUSE_MS) {
    const held = ahead;
    // One use: the next press fetches its own (or the next prefetch does).
    ahead = null;
    const value = await held.value;
    if (value) return value;
  }
  return fetchStreamToken(request);
}

async function fetchStreamToken(
  request: VoiceStreamTokenRequest,
): Promise<VoiceStreamTokenResponse | null> {
  try {
    const { data, error } = await backend.functions.invoke('voice-stream-token', {
      body: request,
    });
    if (error) return null;
    const value = data as Partial<VoiceStreamTokenResponse> | null;
    if (!value || typeof value.token !== 'string' || typeof value.url !== 'string') return null;
    return value as VoiceStreamTokenResponse;
  } catch {
    return null;
  }
}

export interface LiveTranscriptionHandlers {
  /** The whole sentence so far (finals plus the live tail). */
  onInterim: (text: string) => void;
  /** A segment was finalised; the text is everything finalised so far. */
  onFinal: (text: string) => void;
  /** The stream died mid-way (socket error/close or the mic failed). */
  onError: () => void;
  /** Input loudness 0…1 per chunk, for the waveform. */
  onLevel?: (level: number) => void;
}

export interface LiveTranscription {
  /** Stop the mic, flush Deepgram and return the full transcript. */
  stop: () => Promise<string>;
  /** Drop everything without a transcript. */
  cancel: () => void;
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

/**
 * Open the socket and the mic together. Resolves once both are running, or null
 * if either could not start (nothing is left open in that case).
 */
export async function startLiveTranscription(
  session: Pick<VoiceStreamTokenResponse, 'token' | 'url'>,
  handlers: LiveTranscriptionHandlers,
): Promise<LiveTranscription | null> {
  const audio = loadAudioModule();
  if (!audio) return null;
  // One live stream in the app at a time. The recorder is a single native
  // instance, so a second start silently replaced the first's recording and
  // left a handle whose stop no longer reached it — the mic ran on and the
  // screen could not be stopped. A new start ends the previous one first.
  if (active) {
    active.cancel();
    active = null;
  }

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
  const pending: ArrayBuffer[] = [];
  let onClosed: (() => void) | null = null;

  const send = (bytes: Uint8Array): void => {
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    if (!isOpen) {
      if (pending.length < MAX_PENDING_CHUNKS) pending.push(buffer);
      return;
    }
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
      for (const chunk of pending.splice(0)) {
        try {
          socket.send(chunk);
        } catch {
          break;
        }
      }
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

  let subscription: { remove: () => void } | null = null;
  let recording = false;
  function stopAll(): void {
    clearInterval(keepAlive);
    subscription?.remove();
    subscription = null;
    if (recording) {
      recording = false;
      void Promise.resolve(audio!.stopRecording()).catch(() => {});
    }
  }

  try {
    subscription = audio.addListener('AudioData', (event) => {
      if (!event.encoded || event.deltaSize === 0) return;
      const bytes = base64ToBytes(event.encoded);
      if (bytes.length === 0) return;
      handlers.onLevel?.(pcmLevel(bytes));
      send(bytes);
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
    finished = true;
    stopAll();
    try {
      socket.close();
    } catch {
      // Already gone.
    }
    return null;
  }

  if (!(await opened)) {
    finished = true;
    stopAll();
    try {
      socket.close();
    } catch {
      // Already gone.
    }
    return null;
  }
  ready = true;
  // The socket may have died while the mic was still opening.
  if (closed) {
    finished = true;
    stopAll();
    return null;
  }

  const handle: LiveTranscription = {
    stop: async () => {
      if (active === handle) active = null;
      if (finished) return fullText(state);
      finished = true;
      stopAll();
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
        try {
          socket.close();
        } catch {
          // Already gone.
        }
      }
      return fullText(state);
    },
    cancel: () => {
      if (active === handle) active = null;
      if (finished) return;
      finished = true;
      stopAll();
      try {
        socket.close();
      } catch {
        // Already gone.
      }
    },
  };
  active = handle;
  return handle;
}

/** The stream that currently owns the recorder, if any. */
let active: LiveTranscription | null = null;
