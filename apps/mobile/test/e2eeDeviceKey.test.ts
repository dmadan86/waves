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
    await m.loadDeviceKey('acct-a');
    const a = await m.loadDeviceKey('acct-a');
    const b = await m.loadDeviceKey('acct-a');
    expect(b).toBe(a);
    expect(secure.sets).toHaveLength(2);
    const keyWrite = secure.sets.find(([key]) => key === 'waves.e2ee.device.v2.acct-a')!;
    expect(keyWrite[2]).toEqual({
      keychainAccessible: 'after-first-unlock-this-device-only',
    });
  }, 15_000);

  it('survives a relaunch: the same key comes back, nothing is written again', async () => {
    const first = await (await import('../src/e2ee/deviceKey')).loadDeviceKey('acct-a');
    vi.resetModules();
    const again = await (await import('../src/e2ee/deviceKey')).loadDeviceKey('acct-a');
    expect(Array.from(again.publicKey)).toEqual(Array.from(first.publicKey));
    expect(Array.from(again.privateKey)).toEqual(Array.from(first.privateKey));
    expect(secure.sets.filter(([k]) => k === 'waves.e2ee.device.v2.acct-a')).toHaveLength(1);
  }, 15_000);

  it('registers its public key on every call and returns the device id', async () => {
    const m = await import('../src/e2ee/deviceKey');
    const sent: string[] = [];
    const register = async (key: string) => (sent.push(key), 'dev-1');
    expect(await m.registerDevice('acct-a', register)).toBe('dev-1');
    expect(await m.registerDevice('acct-a', register)).toBe('dev-1');
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatch(/^\\x[0-9a-f]{64}$/);
    expect(m.registeredDeviceId('acct-a')).toBe('dev-1');
    m.forgetDeviceId('acct-a');
    expect(m.registeredDeviceId('acct-a')).toBeNull();
  });

  it('discards a device registration that finishes after forgetDeviceId', async () => {
    const m = await import('../src/e2ee/deviceKey');
    await m.loadDeviceKey('acct-a');
    let finish!: (id: string) => void;
    const registering = m.registerDevice(
      'acct-a',
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    m.forgetDeviceId('acct-a');
    finish('stale-device');
    await expect(registering).rejects.toThrow('outlived its session');
    expect(m.registeredDeviceId('acct-a')).toBeNull();
  });

  it('uses distinct keys per account and migrates the legacy key only once', async () => {
    const m = await import('../src/e2ee/deviceKey');
    const old = (await m.loadDeviceKey('legacy-account')).privateKey;
    secure.items.set('waves.e2ee.device.v1', btoa(String.fromCharCode(...old)));
    secure.items.delete('waves.e2ee.device.v1.migrated');
    secure.items.delete('waves.e2ee.device.v2.legacy-account');
    vi.resetModules();
    const keys = await import('../src/e2ee/deviceKey');
    const first = await keys.loadDeviceKey('account-a');
    const second = await keys.loadDeviceKey('account-b');
    expect(Array.from(first.privateKey)).toEqual(Array.from(old));
    expect(Array.from(second.publicKey)).not.toEqual(Array.from(first.publicKey));
    expect(secure.items.get('waves.e2ee.device.v1.migrated')).toBe('account-a');
  });

  it('serializes concurrent legacy migration and gives the key to only one account', async () => {
    const m = await import('../src/e2ee/deviceKey');
    const privateKey = (await m.loadDeviceKey('seed')).privateKey;
    const legacy = btoa(String.fromCharCode(...privateKey));
    secure.items.set('waves.e2ee.device.v1', legacy);
    secure.items.delete('waves.e2ee.device.v1.migrated');
    secure.items.delete('waves.e2ee.device.v2.seed');
    vi.resetModules();
    const keys = await import('../src/e2ee/deviceKey');
    const [a, b] = await Promise.all([
      keys.loadDeviceKey('account-a'),
      keys.loadDeviceKey('account-b'),
    ]);
    expect(secure.items.get('waves.e2ee.device.v1.migrated')).toMatch(/^account-[ab]$/);
    expect(
      [a, b].filter((pair) =>
        Array.from(pair.privateKey).every((value, i) => value === privateKey[i]),
      ),
    ).toHaveLength(1);
  });

  it('reserves the migration owner before copying, so only that owner resumes an interrupted copy', async () => {
    const m = await import('../src/e2ee/deviceKey');
    const old = (await m.loadDeviceKey('seed')).privateKey;
    const legacy = btoa(String.fromCharCode(...old));
    secure.items.set('waves.e2ee.device.v1', legacy);
    secure.items.delete('waves.e2ee.device.v1.migrated');
    secure.items.delete('waves.e2ee.device.v2.account-a');
    secure.items.delete('waves.e2ee.device.v2.account-b');
    secure.sets.length = 0;
    vi.resetModules();
    const keys = await import('../src/e2ee/deviceKey');
    await keys.loadDeviceKey('account-a');
    const scopedIndex = secure.sets.findIndex(([key]) => key === 'waves.e2ee.device.v2.account-a');
    const markerIndex = secure.sets.findIndex(([key]) => key === 'waves.e2ee.device.v1.migrated');
    expect(markerIndex).toBeGreaterThanOrEqual(0);
    expect(scopedIndex).toBeGreaterThan(markerIndex);

    // Interrupted copy: marker names A, A's slot is empty. B must not take the legacy key; A resumes.
    secure.items.delete('waves.e2ee.device.v2.account-a');
    vi.resetModules();
    const again = await import('../src/e2ee/deviceKey');
    const b = await again.loadDeviceKey('account-b');
    const a = await again.loadDeviceKey('account-a');
    expect(Array.from(b.privateKey)).not.toEqual(Array.from(old));
    expect(Array.from(a.privateKey)).toEqual(Array.from(old));
  });
});
