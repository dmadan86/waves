/**
 * Clips for tests: a PCM WAV and an MP4/M4A whose containers say how long they
 * are, the way `_shared/audioDuration.ts` reads them. The handler refuses
 * audio it cannot measure, so a test that sends "audio" as bytes is refused.
 */

export function base64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** A RIFF/WAVE header for 16 kHz mono 16-bit PCM with `seconds` of data bytes behind it. */
export function wavBytes(seconds: number, dataBytes = Math.round(seconds * 32000)): Uint8Array {
  const byteRate = 16000 * 2;
  const dataSize = Math.round(seconds * byteRate);
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) out[at + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);
  return out;
}

function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length, false);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function fullBox(type: string, fields: number[]): Uint8Array {
  const payload = new Uint8Array(4 + fields.length * 4);
  const view = new DataView(payload.buffer);
  fields.forEach((f, i) => view.setUint32(4 + i * 4, f, false));
  return box(type, payload);
}

export interface Mp4Options {
  /** What the movie header says, in seconds. Default: the same as the samples. */
  mvhdSeconds?: number;
  /** What the track header says, in seconds. Default: the same as the samples. */
  mdhdSeconds?: number;
  /** Audio bytes to append after the tables (the decoder plays only what the tables describe). */
  mdatBytes?: number;
}

/**
 * An MP4 with one audio track whose time-to-sample table covers `seconds`
 * (1024-sample AAC frames at 16 kHz), and headers that may lie.
 */
export function mp4Bytes(seconds: number, options: Mp4Options = {}): Uint8Array {
  const timescale = 16000;
  const frames = Math.max(1, Math.round((seconds * timescale) / 1024));
  const sampleTicks = frames * 1024;
  const mvhd = fullBox('mvhd', [
    0,
    0,
    timescale,
    Math.round((options.mvhdSeconds ?? seconds) * timescale),
  ]);
  const mdhd = fullBox('mdhd', [
    0,
    0,
    timescale,
    Math.round((options.mdhdSeconds ?? seconds) * timescale),
    0,
  ]);
  void sampleTicks;
  const stts = fullBox('stts', [1, frames, 1024]);
  const stbl = box('stbl', stts);
  const minf = box('minf', stbl);
  const mdia = box('mdia', concat(mdhd, minf));
  const trak = box('trak', mdia);
  const moov = box('moov', concat(mvhd, trak));
  const ftyp = box('ftyp', new Uint8Array([0x4d, 0x34, 0x41, 0x20, 0, 0, 0, 0]));
  const mdat = box('mdat', new Uint8Array(options.mdatBytes ?? 64));
  return concat(ftyp, moov, mdat);
}

/** One second of PCM WAV, base64: the default clip a test sends. */
export const WAV_CLIP = base64(wavBytes(1));
/** One second of M4A, base64. */
export const M4A_CLIP = base64(mp4Bytes(1));
