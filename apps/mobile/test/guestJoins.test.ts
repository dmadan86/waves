/**
 * The links a guest joined through, kept so a switch to an existing account can
 * join that account to the same groups (`lib/guestSwitch`).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/secureStorage', () => ({ secureAuthStorage: {} }));

const { makeGuestJoinStore } = await import('../src/lib/guestJoins');

function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: vi.fn(async (key: string) => data.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      data.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      data.delete(key);
    }),
  };
}

describe('guest joins', () => {
  it('remembers links per guest, newest first, without repeats', async () => {
    const storage = memory();
    const store = makeGuestJoinStore(storage);

    await store.remember('g1', 'a');
    await store.remember('g1', ' b ');
    await store.remember('g1', 'a');
    await store.remember('g2', 'c');

    expect(await store.read('g1')).toEqual(['a', 'b']);
    expect(await store.read('g2')).toEqual(['c']);
    expect([...storage.data.keys()]).toEqual(['waves.guestJoins.g1', 'waves.guestJoins.g2']);
  });

  it('ignores a blank link or a missing guest', async () => {
    const storage = memory();
    const store = makeGuestJoinStore(storage);

    await store.remember('', 'a');
    await store.remember('g1', '   ');

    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('keeps at most twenty', async () => {
    const store = makeGuestJoinStore(memory());
    for (let i = 0; i < 25; i++) await store.remember('g1', `t${i}`);

    const kept = await store.read('g1');
    expect(kept).toHaveLength(20);
    expect(kept[0]).toBe('t24');
  });

  it('reads anything it cannot parse as nothing, and clears', async () => {
    const storage = memory();
    const store = makeGuestJoinStore(storage);
    storage.data.set('waves.guestJoins.g1', '{not json');
    expect(await store.read('g1')).toEqual([]);

    storage.data.set('waves.guestJoins.g1', JSON.stringify(['a', 3, '', 'b']));
    expect(await store.read('g1')).toEqual(['a', 'b']);

    await store.clear('g1');
    expect(await store.read('g1')).toEqual([]);
  });

  it('treats a storage that throws as empty rather than failing the sign-in', async () => {
    const storage = memory();
    storage.getItem.mockRejectedValueOnce(new Error('keystore locked'));
    expect(await makeGuestJoinStore(storage).read('g1')).toEqual([]);
  });
});
