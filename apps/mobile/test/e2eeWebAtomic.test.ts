import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('web E2EE storage', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await AsyncStorage.clear();
    vi.resetModules();
  });

  it('keeps both records and outbox unchanged when the atomic write fails', async () => {
    const { createLocalStore } = await import('../src/sync/driver.web');
    const Storage = (await import('@react-native-async-storage/async-storage')).default;
    const store = createLocalStore();
    const row = { groupId: 'g', id: 'r', recordJson: '{}', updatedAt: 1 } as never;
    const outbox = {
      id: 'o',
      groupId: 'g',
      msg: { msgId: 'm', ops: [] },
      createdAt: 'now',
    } as never;
    await Storage.setItem(
      'waves:e2ee:store',
      JSON.stringify({ records: [], outbox: [], pending: [] }),
    );
    vi.spyOn(Storage, 'setItem').mockRejectedValue(new Error('disk full'));

    await expect(store.writeE2eeRecords([row], [outbox])).rejects.toThrow('disk full');
    expect(await store.readE2eeRecords()).toEqual([]);
    expect(await store.readE2eeOutbox()).toEqual([]);
  }, 30_000);

  it('sets aside an undecodable combined value instead of overwriting it', async () => {
    const { createLocalStore } = await import('../src/sync/driver.web');
    const Storage = (await import('@react-native-async-storage/async-storage')).default;
    await Storage.setItem('waves:e2ee:store', '{not json');
    const store = createLocalStore();
    expect(await store.readE2eeRecords()).toEqual([]);
    expect(await Storage.getItem('waves:e2ee:store.unreadable')).toBe('{not json');
  }, 30_000);

  it('wipes the unreadable quarantine and legacy E2EE keys', async () => {
    const { createLocalStore } = await import('../src/sync/driver.web');
    const Storage = (await import('@react-native-async-storage/async-storage')).default;
    await Storage.setItem('waves:e2ee:store.unreadable', '{old');
    await Storage.setItem('waves:e2ee:records', '[]');
    await createLocalStore().wipeE2ee();
    expect(await Storage.getItem('waves:e2ee:store.unreadable')).toBeNull();
    expect(await Storage.getItem('waves:e2ee:records')).toBeNull();
  }, 30_000);
});
