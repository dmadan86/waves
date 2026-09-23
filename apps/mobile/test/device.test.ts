/**
 * This phone's stable identity for the device cap.
 *
 * The id must be minted once and then be the same id for ever — or until a
 * sign-out clears it — because a second id is a second device, and a second
 * device is how somebody is pushed over a two-phone limit by their own phone.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const world = vi.hoisted(() => ({
  os: 'android' as string,
  keystore: new Map<string, string>(),
  failRead: false,
  failWrite: false,
  failDelete: false,
  minted: 0,
  device: {
    modelName: null as string | null,
    deviceName: null as string | null,
    osVersion: null as string | null,
  },
  version: '1.2.3' as string | undefined,
}));

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return world.os;
    },
  },
}));
vi.mock('expo-crypto', () => ({
  randomUUID: () => `id-${++world.minted}`,
}));
vi.mock('expo-device', () => ({
  get modelName() {
    return world.device.modelName;
  },
  get deviceName() {
    return world.device.deviceName;
  },
  get osVersion() {
    return world.device.osVersion;
  },
}));
vi.mock('expo-constants', () => ({
  default: {
    get expoConfig() {
      return world.version === undefined ? null : { version: world.version };
    },
  },
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => {
    if (world.failRead) throw new Error('locked');
    return world.keystore.get(key) ?? null;
  },
  setItemAsync: async (key: string, value: string) => {
    if (world.failWrite) throw new Error('locked');
    world.keystore.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    if (world.failDelete) throw new Error('locked');
    world.keystore.delete(key);
  },
}));
vi.mock('@/lib/legacyKeys', () => ({ legacyKeysMigrated: Promise.resolve() }));

type DeviceModule = typeof import('../src/lib/device');
let device: DeviceModule;
let AsyncStorage: typeof import('@react-native-async-storage/async-storage').default;

beforeEach(async () => {
  vi.resetModules();
  world.os = 'android';
  world.keystore.clear();
  world.failRead = false;
  world.failWrite = false;
  world.failDelete = false;
  world.minted = 0;
  world.device = { modelName: null, deviceName: null, osVersion: null };
  world.version = '1.2.3';
  AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  await AsyncStorage.clear();
  device = await import('../src/lib/device');
});

describe('the device id', () => {
  it('is minted once, stored in the keystore, and the same id every time after', async () => {
    const first = await device.deviceId();
    expect(first).toBe('id-1');
    expect(world.keystore.get('waves.device.id')).toBe('id-1');
    expect(await device.deviceId()).toBe('id-1');
    expect(world.minted).toBe(1);
  });

  it('gives two callers asking at once the same id, not two', async () => {
    const [a, b] = await Promise.all([device.deviceId(), device.deviceId()]);
    expect(a).toBe(b);
    expect(world.minted).toBe(1);
  });

  it('reuses an id already stored by an earlier launch', async () => {
    world.keystore.set('waves.device.id', 'kept');
    expect(await device.deviceId()).toBe('kept');
    expect(world.minted).toBe(0);
  });

  it('still answers when the keystore will not read or write', async () => {
    world.failRead = true;
    world.failWrite = true;
    expect(await device.deviceId()).toBe('id-1');
    expect(world.keystore.size).toBe(0);
  });

  it('keeps it in AsyncStorage on the web, where there is no keystore', async () => {
    world.os = 'web';
    const id = await device.deviceId();
    await expect(AsyncStorage.getItem('waves.device.id')).resolves.toBe(id);
    expect(world.keystore.size).toBe(0);

    await device.clearDeviceId();
    await expect(AsyncStorage.getItem('waves.device.id')).resolves.toBeNull();
  });
});

describe('clearing it on sign-out', () => {
  it('means the next account gets a fresh id', async () => {
    await device.deviceId();
    await device.clearDeviceId();
    expect(world.keystore.has('waves.device.id')).toBe(false);
    expect(await device.deviceId()).toBe('id-2');
  });

  it('is not undone by a mint that was already in flight', async () => {
    const minting = device.deviceId();
    const clearing = device.clearDeviceId();
    const minted = await minting;
    await clearing;

    // The in-flight mint answered its caller, but did not write back over the
    // cleared storage or become the cached id.
    expect(minted).toBe('id-1');
    expect(world.keystore.has('waves.device.id')).toBe(false);
    expect(await device.deviceId()).toBe('id-2');
  });

  it('swallows a keystore that will not delete', async () => {
    world.failDelete = true;
    await expect(device.clearDeviceId()).resolves.toBeUndefined();
  });
});

describe('what the phone is called', () => {
  it('uses the model, then the device name, then the platform', () => {
    world.device.modelName = 'Pixel 9';
    expect(device.deviceLabel()).toBe('Pixel 9');
    world.device.modelName = null;
    world.device.deviceName = 'Asha’s phone';
    expect(device.deviceLabel()).toBe('Asha’s phone');
    world.device.deviceName = null;
    expect(device.deviceLabel()).toBe('Android phone');
    world.os = 'ios';
    expect(device.deviceLabel()).toBe('iPhone');
    world.os = 'web';
    expect(device.deviceLabel()).toBe('This device');
  });

  it('puts the OS version on the platform line when there is one', () => {
    expect(device.devicePlatform()).toBe('android');
    world.device.osVersion = '15';
    expect(device.devicePlatform()).toBe('android 15');
  });

  it('reads the app version, or null when the build has none', () => {
    expect(device.appVersion()).toBe('1.2.3');
    world.version = undefined;
    expect(device.appVersion()).toBeNull();
  });

  it('assembles the whole identity', async () => {
    world.device.modelName = 'Pixel 9';
    world.device.osVersion = '15';
    await expect(device.deviceIdentity()).resolves.toEqual({
      deviceId: 'id-1',
      label: 'Pixel 9',
      platform: 'android 15',
      appVersion: '1.2.3',
    });
  });
});
