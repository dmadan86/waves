/**
 * One encrypted message: XChaCha20-Poly1305 under a pair key, a random 24-byte
 * nonce prefixed to the ciphertext, and the routing fields bound in as AAD so a
 * message cannot be replayed to a different group, device or message id.
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

const NONCE_BYTES = 24;
const enc = new TextEncoder();
const dec = new TextDecoder();

export interface EnvelopeAad {
  readonly groupId: string;
  readonly senderDevice: string;
  readonly recipientDevice: string;
  readonly msgId: string;
}

/** What is inside an envelope. `ops` are merge ops or snapshot parts. */
export interface Plaintext {
  readonly v: 1;
  readonly msgId: string;
  readonly ops: readonly unknown[];
}

const BIG = '$big';

/** JSON with bigints as `{"$big":"123"}` so they round-trip exactly. */
export function encodeJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? { [BIG]: v.toString() } : v));
}

export function decodeJson(text: string): unknown {
  return JSON.parse(text, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === BIG && typeof v[BIG] === 'string') return BigInt(v[BIG]);
    }
    return v;
  });
}

const aadBytes = (a: EnvelopeAad): Uint8Array =>
  enc.encode(`${a.groupId}|${a.senderDevice}|${a.recipientDevice}|${a.msgId}`);

function randomNonce(): Uint8Array {
  const c = globalThis.crypto;
  if (!c?.getRandomValues) throw new Error('e2ee: no secure random source; pass a nonce');
  return c.getRandomValues(new Uint8Array(NONCE_BYTES));
}

export function seal(
  key: Uint8Array,
  plaintext: Plaintext,
  aad: EnvelopeAad,
  nonce: Uint8Array = randomNonce(),
): Uint8Array {
  if (nonce.length !== NONCE_BYTES) throw new Error('e2ee: nonce must be 24 bytes');
  const ct = xchacha20poly1305(key, nonce, aadBytes(aad)).encrypt(
    enc.encode(encodeJson(plaintext)),
  );
  const out = new Uint8Array(NONCE_BYTES + ct.length);
  out.set(nonce);
  out.set(ct, NONCE_BYTES);
  return out;
}

/** Throws on a wrong key, a tampered byte or any AAD mismatch. */
export function open(key: Uint8Array, sealed: Uint8Array, aad: EnvelopeAad): Plaintext {
  if (sealed.length < NONCE_BYTES + 16) throw new Error('e2ee: message too short');
  const nonce = sealed.subarray(0, NONCE_BYTES);
  const text = dec.decode(
    xchacha20poly1305(key, nonce, aadBytes(aad)).decrypt(sealed.subarray(NONCE_BYTES)),
  );
  const p = decodeJson(text) as Plaintext;
  if (!p || p.v !== 1 || typeof p.msgId !== 'string' || !Array.isArray(p.ops)) {
    throw new Error('e2ee: unsupported payload');
  }
  return p;
}
