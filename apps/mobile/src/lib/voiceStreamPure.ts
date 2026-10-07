/**
 * The pure half of live transcription: turning Deepgram's streaming messages
 * into one transcript, and the small byte helpers the PCM path needs. No
 * sockets, no native modules — everything here is unit-tested.
 */

export interface TranscriptState {
  /** Finalised segments, in order. */
  readonly finals: readonly string[];
  /** The current not-yet-final segment (replaced by every interim result). */
  readonly interim: string;
  /**
   * Deepgram's other hypotheses for each final segment (`channel.alternatives[1..]`),
   * parallel to `finals`. Empty arrays when the stream sent only one.
   */
  readonly finalAlts?: readonly (readonly string[])[];
  /** The other hypotheses for the interim segment. */
  readonly interimAlts?: readonly string[];
}

export const EMPTY_TRANSCRIPT: TranscriptState = {
  finals: [],
  interim: '',
  finalAlts: [],
  interimAlts: [],
};

/** The most whole-sentence alternatives handed on. */
const MAX_STREAM_ALTERNATIVES = 5;

interface ResultsMessage {
  type?: unknown;
  is_final?: unknown;
  channel?: { alternatives?: { transcript?: unknown }[] };
}

/** Parse a socket text frame; null when it is not a JSON object. */
export function parseMessage(raw: unknown): ResultsMessage | null {
  if (typeof raw !== 'string') return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' ? (value as ResultsMessage) : null;
  } catch {
    return null;
  }
}

/** Fold one Deepgram message into the transcript. Non-result messages pass through. */
export function applyMessage(state: TranscriptState, message: unknown): TranscriptState {
  const parsed = typeof message === 'string' ? parseMessage(message) : (message as ResultsMessage);
  if (!parsed || (parsed.type !== undefined && parsed.type !== 'Results')) return state;
  const alternatives = parsed.channel?.alternatives;
  if (!Array.isArray(alternatives)) return state;
  const raw = alternatives[0]?.transcript;
  const text = typeof raw === 'string' ? raw.trim() : '';
  const others = segmentAlternatives(alternatives, text);
  const finalAlts = state.finalAlts ?? state.finals.map(() => []);
  if (parsed.is_final === true) {
    // An empty final just closes the segment — its interim is spent.
    return text
      ? {
          finals: [...state.finals, text],
          interim: '',
          finalAlts: [...finalAlts, others],
          interimAlts: [],
        }
      : { finals: state.finals, interim: '', finalAlts, interimAlts: [] };
  }
  return { finals: state.finals, interim: text, finalAlts, interimAlts: others };
}

/** A segment's other hypotheses: alternatives[1..], trimmed, non-empty, unlike the top one. */
function segmentAlternatives(alternatives: unknown[], top: string): string[] {
  const out: string[] = [];
  for (const entry of alternatives.slice(1)) {
    const raw = (entry as { transcript?: unknown } | null)?.transcript;
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (text && text !== top && !out.includes(text)) out.push(text);
  }
  return out;
}

/**
 * Whole-sentence alternatives for the streamed transcript, best first: the
 * full text with one segment swapped for one of its other hypotheses. Empty
 * when Deepgram returned a single alternative per segment (its default).
 */
export function streamAlternatives(state: TranscriptState): string[] {
  const segments = [...state.finals, state.interim];
  const alts = [...(state.finalAlts ?? state.finals.map(() => [])), state.interimAlts ?? []];
  const top = fullText(state);
  const out: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    for (const alt of alts[i] ?? []) {
      const sentence = segments
        .map((segment, j) => (j === i ? alt : segment))
        .filter(Boolean)
        .join(' ')
        .trim();
      if (sentence && sentence !== top && !out.includes(sentence)) out.push(sentence);
      if (out.length >= MAX_STREAM_ALTERNATIVES) return out;
    }
  }
  return out;
}

/** What the captions show while speaking: finals plus the live tail. */
export function liveText(state: TranscriptState): string {
  return [...state.finals, state.interim].filter(Boolean).join(' ');
}

/**
 * The transcript to send: every final segment, plus an interim tail that never
 * got finalised (the socket closed or the wait timed out before it did).
 */
export function fullText(state: TranscriptState): string {
  return liveText(state).trim();
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP: Record<string, number> = Object.fromEntries(
  [...B64].map((char, index) => [char, index]),
);

/** Base64 → bytes without relying on a global `atob`. Ignores padding and whitespace. */
export function base64ToBytes(input: string): Uint8Array {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const char of clean) {
    buffer = (buffer << 6) | (B64_LOOKUP[char] ?? 0);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, index);
}

/** Loudness of a little-endian 16-bit PCM chunk, 0…1 (RMS, lightly boosted for speech). */
export function pcmLevel(bytes: Uint8Array): number {
  const samples = Math.floor(bytes.length / 2);
  if (samples === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    let value = bytes[i * 2]! | (bytes[i * 2 + 1]! << 8);
    if (value & 0x8000) value -= 0x10000;
    sum += value * value;
  }
  const rms = Math.sqrt(sum / samples) / 32768;
  return Math.max(0, Math.min(1, rms * 6));
}
