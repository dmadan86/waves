import { beforeEach, describe, expect, it, vi } from 'vitest';

const secure = vi.hoisted(() => ({ items: new Map<string, string>(), sets: [] as unknown[][] }));
vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'after-first-unlock-this-device-only',
  getItemAsync: async (k: string) => secure.items.get(k) ?? null,
  setItemAsync: async (k: string, v: string, o: unknown) => {
    secure.sets.push([k, v, o]);
    secure.items.set(k, v);
  },
  deleteItemAsync: async (k: string) => void secure.items.delete(k),
}));
vi.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n)),
}));

beforeEach(() => {
  secure.items.clear();
  secure.sets.length = 0;
  vi.resetModules();
});

describe('device key', () => {
  it('is generated once, kept in the keystore with the mirror key accessibility', async () => {
    const m = await import('../src/e2ee/deviceKey');
    const a = await m.loadDeviceKey();
    const b = await m.loadDeviceKey();
    expect(b).toBe(a);
    expect(secure.sets).toHaveLength(1);
    expect(secure.sets[0]![0]).toBe('waves.e2ee.device.v1');
    expect(secure.sets[0]![2]).toEqual({
      keychainAccessible: 'after-first-unlock-this-device-only',
    });
  });

  it('survives a relaunch: the same key comes back, nothing is written again', async () => {
    const first = await (await import('../src/e2ee/deviceKey')).loadDeviceKey();
    vi.resetModules();
    const again = await (await import('../src/e2ee/deviceKey')).loadDeviceKey();
    expect(Array.from(again.publicKey)).toEqual(Array.from(first.publicKey));
    expect(Array.from(again.privateKey)).toEqual(Array.from(first.privateKey));
    expect(secure.sets).toHaveLength(1);
  });

  it('registers its public key on every call and returns the device id', async () => {
    const m = await import('../src/e2ee/deviceKey');
    const sent: string[] = [];
    const register = async (key: string) => (sent.push(key), 'dev-1');
    expect(await m.registerDevice(register)).toBe('dev-1');
    expect(await m.registerDevice(register)).toBe('dev-1');
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatch(/^\\x[0-9a-f]{64}$/);
    expect(m.registeredDeviceId()).toBe('dev-1');
    m.forgetDeviceId();
    expect(m.registeredDeviceId()).toBeNull();
  });
});
