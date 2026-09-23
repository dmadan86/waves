/**
 * The one-time move of pre-rename (`baaki.*`) keys to their `waves.*` names.
 *
 * What must hold: a value moves exactly once and the old key goes; a value
 * already under the new name wins over the old one; a move that cannot write
 * keeps the old key for the next launch; retired keys are swept, never moved;
 * and none of it can reject, because an app that will not launch is worse
 * than one that starts fresh.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const keychain = vi.hoisted(() => ({
  items: new Map<string, string>(),
  failWrites: false,
  failReads: false,
  failDeletes: false,
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => {
    if (keychain.failReads) throw new Error('keychain locked');
    return keychain.items.get(key) ?? null;
  },
  setItemAsync: async (key: string, value: string) => {
    if (keychain.failWrites) throw new Error('keychain full');
    keychain.items.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    if (keychain.failDeletes) throw new Error('keychain busy');
    keychain.items.delete(key);
  },
}));

type Storage = typeof import('@react-native-async-storage/async-storage').default;

/**
 * A cold launch: a fresh module graph (so the migration runs again at import),
 * with `seed` writing the device's storage before it does.
 */
async function launch(seed: (storage: Storage) => Promise<void> | void = () => {}) {
  vi.resetModules();
  const storage = (await import('@react-native-async-storage/async-storage')).default;
  await seed(storage);
  const { legacyKeysMigrated } = await import('../src/lib/legacyKeys');
  await legacyKeysMigrated;
  return storage;
}

beforeEach(() => {
  keychain.items.clear();
  keychain.failWrites = false;
  keychain.failReads = false;
  keychain.failDeletes = false;
});

describe('moving pre-rename keys', () => {
  it('moves a plain value to its new name and deletes the old key', async () => {
    const storage = await launch((s) => s.setItem('baaki.language', 'ta'));
    await expect(storage.getItem('waves.language')).resolves.toBe('ta');
    await expect(storage.getItem('baaki.language')).resolves.toBeNull();
  });

  it('keeps a value already under the new name and still sweeps the old one', async () => {
    const storage = await launch(async (s) => {
      await s.setItem('baaki.theme_scheme', 'dark');
      await s.setItem('waves.theme_scheme', 'light');
    });
    await expect(storage.getItem('waves.theme_scheme')).resolves.toBe('light');
    await expect(storage.getItem('baaki.theme_scheme')).resolves.toBeNull();
  });

  it('moves keychain values inside the keychain', async () => {
    keychain.items.set('baaki.device.id', 'dev-1');
    const storage = await launch();
    expect(keychain.items.get('waves.device.id')).toBe('dev-1');
    expect(keychain.items.has('baaki.device.id')).toBe(false);
    await expect(storage.getItem('waves.device.id')).resolves.toBeNull();
  });

  it('keeps the old keychain value when the new one cannot be written', async () => {
    keychain.items.set('baaki.app_lock_enabled', 'true');
    keychain.failWrites = true;
    await launch();
    expect(keychain.items.get('baaki.app_lock_enabled')).toBe('true');
    expect(keychain.items.has('waves.app_lock_enabled')).toBe(false);
  });

  it('settles, moving nothing, when the keychain refuses to be read', async () => {
    keychain.items.set('baaki.device.id', 'dev-1');
    keychain.failReads = true;
    await launch();
    expect(keychain.items.get('baaki.device.id')).toBe('dev-1');
  });

  it('settles when an old keychain value will not delete after moving', async () => {
    keychain.items.set('baaki.device.id', 'dev-1');
    keychain.failDeletes = true;
    await launch();
    expect(keychain.items.get('waves.device.id')).toBe('dev-1');
  });

  it('keeps an old plain value when its new name cannot be written', async () => {
    const storage = await launch(async (s) => {
      await s.setItem('baaki:queue', '[1]');
      vi.spyOn(s, 'setItem').mockRejectedValue(new Error('disk full'));
    });
    vi.restoreAllMocks();
    await expect(storage.getItem('baaki:queue')).resolves.toBe('[1]');
    await expect(storage.getItem('waves:queue')).resolves.toBeNull();
  });

  it('settles when a plain read or delete throws', async () => {
    const launched = launch(async (s) => {
      await s.setItem('baaki.release_policy', 'x');
      vi.spyOn(s, 'getItem').mockRejectedValue(new Error('io'));
      vi.spyOn(s, 'removeItem').mockRejectedValue(new Error('io'));
    });
    await expect(launched).resolves.toBeDefined();
    vi.restoreAllMocks();
    // Nothing could be read, so nothing moved: the old value waits for next launch.
    await expect((await launched).getItem('baaki.release_policy')).resolves.toBe('x');
  });
});

describe('retired keys', () => {
  it('sweeps the device-wide intro flags instead of moving them', async () => {
    const storage = await launch(async (s) => {
      await s.setItem('baaki.onboarding_seen', '1');
      await s.setItem('waves.onboarding_seen', '1');
      await s.setItem('waves.tour_seen_v1', '1');
    });
    for (const key of ['baaki.onboarding_seen', 'waves.onboarding_seen', 'waves.tour_seen_v1']) {
      await expect(storage.getItem(key)).resolves.toBeNull();
    }
  });
});
