/** Account scoped device identities for the end-to-end encrypted couple space. */

import { e2ee } from '@waves/core';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { base64ToBytes, bytesToBase64 } from '@/sync/rowCipher';

export const DEVICE_KEY_SLOT = 'waves.e2ee.device.v1';
const MIGRATED_SLOT = `${DEVICE_KEY_SLOT}.migrated`;
const slot = (profileId: string) => `waves.e2ee.device.v2.${encodeURIComponent(profileId)}`;
const pairs = new Map<string, Promise<e2ee.DeviceKeyPair>>();
const deviceIds = new Map<string, string>();

async function loadOrCreate(profileId: string): Promise<e2ee.DeviceKeyPair> {
  const keySlot = slot(profileId);
  let stored = await SecureStore.getItemAsync(keySlot);
  if (!stored) {
    // The v1 identity can be adopted by only the first profile that signs in
    // after this upgrade. Persist the marker before writing the scoped slot.
    const migrated = await SecureStore.getItemAsync(MIGRATED_SLOT);
    if (migrated === null) {
      const legacy = await SecureStore.getItemAsync(DEVICE_KEY_SLOT);
      if (legacy) {
        await SecureStore.setItemAsync(MIGRATED_SLOT, profileId);
        stored = legacy;
        await SecureStore.setItemAsync(keySlot, legacy, {
          keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
        });
      } else {
        await SecureStore.setItemAsync(MIGRATED_SLOT, profileId);
      }
    }
  }
  if (stored) {
    const privateKey = base64ToBytes(stored);
    return e2ee.generateDeviceKeyPair(() => privateKey);
  }
  const made = e2ee.generateDeviceKeyPair((n) => Crypto.getRandomBytes(n));
  await SecureStore.setItemAsync(keySlot, bytesToBase64(made.privateKey), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  return made;
}

export function loadDeviceKey(profileId: string): Promise<e2ee.DeviceKeyPair> {
  let pair = pairs.get(profileId);
  if (!pair) {
    pair = loadOrCreate(profileId).catch((error) => {
      pairs.delete(profileId);
      throw error;
    });
    pairs.set(profileId, pair);
  }
  return pair;
}

export const bytesToHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const toBytea = (b: Uint8Array): string => `\\x${bytesToHex(b)}`;
export const fromBytea = (s: string): Uint8Array => hexToBytes(s.replace(/^\\x/, ''));

export async function clockId(profileId: string): Promise<string> {
  return bytesToHex((await loadDeviceKey(profileId)).publicKey).slice(0, 16);
}

export async function registerDevice(
  profileId: string,
  register: (publicKeyBytea: string) => Promise<string>,
): Promise<string> {
  const { publicKey } = await loadDeviceKey(profileId);
  const id = await register(toBytea(publicKey));
  deviceIds.set(profileId, id);
  return id;
}

export const registeredDeviceId = (profileId: string): string | null =>
  deviceIds.get(profileId) ?? null;
export function forgetDeviceId(profileId?: string): void {
  if (profileId === undefined) deviceIds.clear();
  else deviceIds.delete(profileId);
}
