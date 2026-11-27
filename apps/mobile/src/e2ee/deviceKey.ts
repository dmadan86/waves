/**
 * This install's key pair for the end-to-end encrypted couple space.
 *
 * The private key is made once and lives only in the OS keystore, with the same
 * accessibility the mirror's key uses (readable after first unlock, never moved to
 * another phone by a backup restore). It is never written to a backup file.
 */

import { e2ee } from '@waves/core';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { base64ToBytes, bytesToBase64 } from '@/sync/rowCipher';

export const DEVICE_KEY_SLOT = 'waves.e2ee.device.v1';

let pair: Promise<e2ee.DeviceKeyPair> | null = null;

async function loadOrCreate(): Promise<e2ee.DeviceKeyPair> {
  const stored = await SecureStore.getItemAsync(DEVICE_KEY_SLOT);
  if (stored) {
    const privateKey = base64ToBytes(stored);
    return e2ee.generateDeviceKeyPair(() => privateKey);
  }
  const made = e2ee.generateDeviceKeyPair((n) => Crypto.getRandomBytes(n));
  await SecureStore.setItemAsync(DEVICE_KEY_SLOT, bytesToBase64(made.privateKey), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  return made;
}

/** The key pair, minted on first use. A failed load is not cached. */
export function loadDeviceKey(): Promise<e2ee.DeviceKeyPair> {
  pair ??= loadOrCreate().catch((error) => {
    pair = null;
    throw error;
  });
  return pair;
}

export const bytesToHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** How PostgREST spells a bytea value, in and out. */
export const toBytea = (b: Uint8Array): string => `\\x${bytesToHex(b)}`;
export const fromBytea = (s: string): Uint8Array => hexToBytes(s.replace(/^\\x/, ''));

/** Short id for this phone's logical clock: needs no network, unique per key. */
export async function clockId(): Promise<string> {
  return bytesToHex((await loadDeviceKey()).publicKey).slice(0, 16);
}

let deviceId: string | null = null;

/**
 * Tell the server this phone's public key (idempotent per account) and remember the
 * device id it hands back. Call on every sign-in: a new account on this phone gets its
 * own id for the same key.
 */
export async function registerDevice(
  register: (publicKeyBytea: string) => Promise<string>,
): Promise<string> {
  const { publicKey } = await loadDeviceKey();
  deviceId = await register(toBytea(publicKey));
  return deviceId;
}

export const registeredDeviceId = (): string | null => deviceId;

/** Sign-out: the id belonged to that account. The key itself stays on the phone. */
export function forgetDeviceId(): void {
  deviceId = null;
}
