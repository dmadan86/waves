/**
 * Device keys for the end-to-end encrypted couple space. Each device owns an
 * X25519 keypair; two devices derive one symmetric pair key from it. Pure JS
 * (@noble), so the same code runs on the phones and in tests.
 */

import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

/** Randomness is injected so tests are deterministic. */
export type RandomBytes = (length: number) => Uint8Array;

export interface DeviceKeyPair {
  readonly publicKey: Uint8Array;
  readonly privateKey: Uint8Array;
}

const INFO = new TextEncoder().encode('waves-e2ee-v1');

export function generateDeviceKeyPair(randomBytes: RandomBytes): DeviceKeyPair {
  const privateKey = randomBytes(32);
  if (privateKey.length !== 32) throw new Error('e2ee: randomBytes must return 32 bytes');
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
}

/** Raw X25519 shared secret. An all-zero result (low-order peer key) is refused. */
export function sharedSecret(myPrivate: Uint8Array, theirPublic: Uint8Array): Uint8Array {
  let secret: Uint8Array;
  try {
    secret = x25519.getSharedSecret(myPrivate, theirPublic);
  } catch {
    throw new Error('e2ee: invalid key');
  }
  if (secret.every((b) => b === 0)) throw new Error('e2ee: degenerate shared secret');
  return secret;
}

/** 32-byte symmetric key for one device pair: HKDF-SHA256(X25519, empty salt, "waves-e2ee-v1"). */
export function pairKey(myPrivate: Uint8Array, theirPublic: Uint8Array): Uint8Array {
  return hkdf(sha256, sharedSecret(myPrivate, theirPublic), new Uint8Array(0), INFO, 32);
}
