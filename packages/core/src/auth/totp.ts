/**
 * Six-digit time codes (RFC 6238 over RFC 4226, HMAC-SHA1, 30-second steps) for
 * company two-step login.
 *
 * SHA-1 and HMAC are written out here rather than borrowed so the phone (Hermes
 * has no WebCrypto), the edge functions and the web share one dependency-free
 * implementation. SHA-1 is what every authenticator app speaks; it is used only
 * as an HMAC, where its collision weakness does not apply.
 */

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Bytes of secret we mint: 160 bits, the RFC 4226 recommendation. */
export const TOTP_SECRET_BYTES = 20;

function rotl(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

export function sha1(message: Uint8Array): Uint8Array {
  const length = message.length;
  const padded = new Uint8Array((((length + 8) >> 6) + 1) * 64);
  padded.set(message);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  // Bit length as 64-bit big-endian; messages here are far below 2^32 bits.
  view.setUint32(padded.length - 4, (length * 8) >>> 0);
  view.setUint32(padded.length - 8, Math.floor((length * 8) / 2 ** 32));

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 80; i += 1)
      w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i += 1) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const t = (rotl(a, 5) + f + e + k + w[i]!) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = t;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => outView.setUint32(i * 4, h));
  return out;
}

export function hmacSha1(key: Uint8Array, message: Uint8Array): Uint8Array {
  const block = new Uint8Array(64);
  block.set(key.length > 64 ? sha1(key) : key);
  const inner = new Uint8Array(64 + message.length);
  const outer = new Uint8Array(64 + 20);
  for (let i = 0; i < 64; i += 1) {
    inner[i] = block[i]! ^ 0x36;
    outer[i] = block[i]! ^ 0x5c;
  }
  inner.set(message, 64);
  outer.set(sha1(inner), 64);
  return sha1(outer);
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** Null for anything that is not base32 (spaces, dashes and case are forgiven). */
export function base32Decode(text: string): Uint8Array | null {
  const clean = text.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  if (clean === '' || !/^[A-Z2-7]+$/.test(clean)) return null;
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** The 30-second step a moment falls in. */
export function totpStep(nowMs: number, periodSeconds = TOTP_PERIOD_SECONDS): number {
  return Math.floor(nowMs / 1000 / periodSeconds);
}

/** Seconds left before the code for `nowMs` changes (1..30). */
export function totpSecondsLeft(nowMs: number, periodSeconds = TOTP_PERIOD_SECONDS): number {
  return periodSeconds - (Math.floor(nowMs / 1000) % periodSeconds);
}

/** The code for one step (RFC 4226 HOTP with the step as the counter). */
export function totpAt(secret: Uint8Array, step: number, digits = TOTP_DIGITS): string {
  const counter = new Uint8Array(8);
  const view = new DataView(counter.buffer);
  view.setUint32(0, Math.floor(step / 2 ** 32));
  view.setUint32(4, step >>> 0);
  const mac = hmacSha1(secret, counter);
  const offset = mac[19]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) |
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function totpNow(secret: Uint8Array, nowMs: number): string {
  return totpAt(secret, totpStep(nowMs));
}

/**
 * The step a typed code matches within ±`window` steps of now, or null. Every
 * candidate is compared, so timing does not say which step matched. Replay
 * (a step at or below the last one used) is the caller's job, atomically, in
 * the database.
 */
export function matchTotp(
  secret: Uint8Array,
  code: string,
  nowMs: number,
  window = 1,
): number | null {
  const typed = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(typed)) return null;
  const now = totpStep(nowMs);
  let matched: number | null = null;
  for (let step = now - window; step <= now + window; step += 1) {
    const expected = totpAt(secret, step);
    let diff = 0;
    for (let i = 0; i < expected.length; i += 1)
      diff |= expected.charCodeAt(i) ^ typed.charCodeAt(i);
    if (diff === 0 && matched === null) matched = step;
  }
  return matched;
}

/** The link an authenticator app reads (`otpauth://totp/...`). */
export function otpauthUri(secretBase32: string, account: string, issuer = 'Waves'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`;
}
