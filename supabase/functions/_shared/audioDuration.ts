/**
 * How long a clip is, read from the bytes before any of them leave this
 * server. Deepgram bills what it decodes, and the client's `durationMs` is the
 * client's word, so a clip is only uploaded when its container says, in a way
 * the decoder will follow, that it is short enough.
 *
 * Accepted containers:
 *   - RIFF/WAVE, PCM only: seconds = data bytes / (rate x channels x bits/8),
 *     computed from the fmt fields — the stored byteRate is not trusted — and
 *     the data bytes are the bytes actually present, not the header's claim.
 *   - MP4 / M4A (what the watch records): the longest of the movie header
 *     (mvhd), every track header (mdhd) and every track's time-to-sample table
 *     (stts), each in its own timescale. A decoder plays the samples the
 *     tables describe, so the tables bound what Deepgram will hear.
 *
 * Anything else — a container this cannot read, or a file that does not parse
 * — is `null`, and the caller refuses it.
 */

const ascii = (bytes: Uint8Array, at: number, n: number): string =>
  String.fromCharCode(...bytes.subarray(at, at + n));

/** Seconds in a PCM WAV, or null when it is not one this can read. */
export function wavDurationSeconds(bytes: Uint8Array): number | null {
  if (bytes.length < 44) return null;
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 12;
  let byteRate = 0;
  while (at + 8 <= bytes.length) {
    const id = ascii(bytes, at, 4);
    const size = view.getUint32(at + 4, true);
    if (id === 'fmt ' && at + 24 <= bytes.length) {
      const format = view.getUint16(at + 8, true);
      const channels = view.getUint16(at + 10, true);
      const sampleRate = view.getUint32(at + 12, true);
      const bits = view.getUint16(at + 22, true);
      // PCM (1) or WAVE_FORMAT_EXTENSIBLE (0xfffe) with whole-byte samples only.
      if (format !== 1 && format !== 0xfffe) return null;
      if (channels < 1 || channels > 8 || sampleRate < 8000 || sampleRate > 192_000) return null;
      if (bits !== 8 && bits !== 16 && bits !== 24 && bits !== 32) return null;
      byteRate = sampleRate * channels * (bits / 8);
    } else if (id === 'data') {
      if (byteRate <= 0) return null;
      const data = Math.min(size, bytes.length - at - 8);
      return data / byteRate;
    }
    at += 8 + size + (size % 2);
  }
  return null;
}

interface Box {
  type: string;
  /** First byte of the payload. */
  start: number;
  /** One past the last byte. */
  end: number;
}

/** The boxes between `from` and `to`, or null when the layout is not sane. */
function boxes(bytes: Uint8Array, from: number, to: number): Box[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = view.getUint32(at, false);
    const type = ascii(bytes, at + 4, 4);
    let header = 8;
    if (size === 1) {
      if (at + 16 > to) return null;
      const high = view.getUint32(at + 8, false);
      const low = view.getUint32(at + 12, false);
      if (high !== 0) return null;
      size = low;
      header = 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < header || at + size > to) return null;
    out.push({ type, start: at + header, end: at + size });
    at += size;
  }
  return out;
}

const find = (list: Box[], type: string): Box[] => list.filter((b) => b.type === type);

/** Seconds in an MP4 / M4A, or null when its tables cannot be read. */
export function mp4DurationSeconds(bytes: Uint8Array): number | null {
  const top = boxes(bytes, 0, bytes.length);
  if (!top) return null;
  const moov = find(top, 'moov')[0];
  if (!moov) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const inMoov = boxes(bytes, moov.start, moov.end);
  if (!inMoov) return null;

  // A full-box header: version (1) + flags (3), then the fields.
  const timed = (box: Box, isMvhd: boolean): number | null => {
    const version = bytes[box.start];
    // mvhd/mdhd v0: creation(4) modification(4) timescale(4) duration(4);
    // v1: creation(8) modification(8) timescale(4) duration(8).
    const at = box.start + 4;
    if (version === 0) {
      if (at + 16 > box.end) return null;
      const timescale = view.getUint32(at + 8, false);
      const duration = view.getUint32(at + 12, false);
      if (timescale <= 0) return null;
      // 0xffffffff means "unknown": not a bound, refuse.
      if (duration === 0xffffffff) return null;
      return duration / timescale;
    }
    if (version === 1) {
      if (at + 28 > box.end) return null;
      const timescale = view.getUint32(at + 16, false);
      const high = view.getUint32(at + 20, false);
      const low = view.getUint32(at + 24, false);
      if (timescale <= 0 || high !== 0) return null;
      return low / timescale;
    }
    void isMvhd;
    return null;
  };

  const mvhd = find(inMoov, 'mvhd')[0];
  if (!mvhd) return null;
  let longest = timed(mvhd, true);
  if (longest === null) return null;

  for (const trak of find(inMoov, 'trak')) {
    const inTrak = boxes(bytes, trak.start, trak.end);
    const mdia = inTrak && find(inTrak, 'mdia')[0];
    const inMdia = mdia && boxes(bytes, mdia.start, mdia.end);
    const mdhd = inMdia && find(inMdia, 'mdhd')[0];
    if (!inMdia || !mdhd) return null;
    const version = bytes[mdhd.start];
    const at = mdhd.start + 4;
    const timescale =
      version === 0 ? view.getUint32(at + 8, false) : view.getUint32(at + 16, false);
    if (timescale <= 0) return null;
    const mdhdSeconds = timed(mdhd, false);
    if (mdhdSeconds === null) return null;
    longest = Math.max(longest, mdhdSeconds);

    const minf = find(inMdia, 'minf')[0];
    const inMinf = minf && boxes(bytes, minf.start, minf.end);
    const stbl = inMinf && find(inMinf, 'stbl')[0];
    const inStbl = stbl && boxes(bytes, stbl.start, stbl.end);
    const stts = inStbl && find(inStbl, 'stts')[0];
    if (!stts) return null;
    // stts: version/flags (4), entry count (4), then (sample count, delta) pairs.
    if (stts.start + 8 > stts.end) return null;
    const entries = view.getUint32(stts.start + 4, false);
    if (stts.start + 8 + entries * 8 > stts.end) return null;
    let ticks = 0;
    for (let i = 0; i < entries; i += 1) {
      const count = view.getUint32(stts.start + 8 + i * 8, false);
      const delta = view.getUint32(stts.start + 12 + i * 8, false);
      ticks += count * delta;
    }
    longest = Math.max(longest, ticks / timescale);
  }
  return longest;
}

const WAV_TYPES = new Set(['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave']);
const MP4_TYPES = new Set(['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/mp4a-latm']);

/**
 * Seconds in a clip of the given media type, or null when the type is not one
 * this can measure or the bytes do not parse as that type. Null is a refusal.
 */
export function clipDurationSeconds(bytes: Uint8Array, mimeType: string): number | null {
  const type = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (WAV_TYPES.has(type)) return wavDurationSeconds(bytes);
  if (MP4_TYPES.has(type)) return mp4DurationSeconds(bytes);
  return null;
}
