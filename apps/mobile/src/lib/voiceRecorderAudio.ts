/**
 * Pure audio and archive helpers for the voice test recorder: the WAV wrapper
 * for raw 16 kHz mono PCM, the "stop after 2 s of silence" rule, and a tiny
 * uncompressed ZIP writer. The ZIP exists because no zip library is installed
 * and this tool may not add a native dependency; WAVs do not compress much
 * anyway, so "stored" entries lose nothing.
 */

export const SAMPLE_RATE = 16000;
export const SILENCE_STOP_MS = 2000;
export const MAX_RECORDING_MS = 30_000;
/** Give up if nobody starts speaking within this long. */
export const NO_SPEECH_MS = 8000;
/** pcmLevel() above this counts as speech. */
export const SPEECH_LEVEL = 0.12;

/** A 44-byte canonical WAV header followed by the PCM. */
export function pcmToWav(pcm: Uint8Array): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);
  const text = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i++) out[offset + i] = value.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

export function pcmDurationMs(byteLength: number): number {
  return Math.round((byteLength / 2 / SAMPLE_RATE) * 1000);
}

export interface SilenceState {
  elapsedMs: number;
  heardSpeech: boolean;
  quietMs: number;
}

export const SILENCE_START: SilenceState = { elapsedMs: 0, heardSpeech: false, quietMs: 0 };

/** Feed one chunk's loudness and length; says whether to stop and why. */
export function stepSilence(
  state: SilenceState,
  level: number,
  chunkMs: number,
): { state: SilenceState; stop: null | 'silence' | 'no-speech' | 'max' } {
  const loud = level >= SPEECH_LEVEL;
  const next: SilenceState = {
    elapsedMs: state.elapsedMs + chunkMs,
    heardSpeech: state.heardSpeech || loud,
    quietMs: loud ? 0 : state.quietMs + chunkMs,
  };
  let stop: null | 'silence' | 'no-speech' | 'max' = null;
  if (next.heardSpeech && next.quietMs >= SILENCE_STOP_MS) stop = 'silence';
  else if (!next.heardSpeech && next.elapsedMs >= NO_SPEECH_MS) stop = 'no-speech';
  else if (next.elapsedMs >= MAX_RECORDING_MS) stop = 'max';
  return { state: next, stop };
}

// ─────────────────────────────────────────────────────────────── zip ──

let crcTable: Uint32Array | null = null;

export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

/** A ZIP with every entry stored (method 0). Names are UTF-8. */
export function buildZip(entries: readonly ZipEntry[], now: Date = new Date(0)): Uint8Array {
  const encoder = new TextEncoder();
  const dosTime =
    (now.getUTCHours() << 11) | (now.getUTCMinutes() << 5) | (now.getUTCSeconds() >> 1);
  const dosDate =
    (Math.max(0, now.getUTCFullYear() - 1980) << 9) |
    ((now.getUTCMonth() + 1) << 5) |
    now.getUTCDate();

  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.bytes);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, entry.bytes.length, true);
    lv.setUint32(22, entry.bytes.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, entry.bytes.length, true);
    cv.setUint32(24, entry.bytes.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local, entry.bytes);
    centrals.push(central);
    offset += local.length + entry.bytes.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const parts = [...locals, ...centrals, end];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
