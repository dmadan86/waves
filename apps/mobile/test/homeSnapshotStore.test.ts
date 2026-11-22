import { beforeEach, describe, expect, it, vi } from 'vitest';

import { snapshotKey, type HomeSnapshot } from '../src/lib/homeSnapshot';
import { clearHomeSnapshot, saveHomeSnapshot } from '../src/lib/homeSnapshotStore';

const h = vi.hoisted(() => ({
  disk: new Map<string, string>(),
  release: null as null | (() => void),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => h.disk.get(k) ?? null,
    removeItem: async (k: string) => void h.disk.delete(k),
    setItem: async (k: string, v: string) => {
      await new Promise<void>((resolve) => (h.release = resolve));
      h.disk.set(k, v);
    },
  },
}));
vi.mock('react', () => ({ useEffect: () => {}, useState: () => [null, () => {}] }));
vi.mock('@/sync/rowCipher', () => ({
  loadKey: async () => new Uint8Array(1),
  encryptWith: (_k: unknown, v: string) => v,
  decryptWith: (_k: unknown, v: string) => v,
}));

const row = { key: 'g', title: 'G', memberLabel: '', amountText: '', directionLabel: '' };
const snap: HomeSnapshot = {
  v: 1,
  viewerId: 'a',
  headline: { currency: 'INR', net: '0', owed: '0', owing: '0', owedGroups: 0, owingGroups: 0 },
  needs: [],
  needsTotal: 0,
  comingUp: [],
  personal: row,
  groups: [],
};

describe('home snapshot store', () => {
  beforeEach(() => h.disk.clear());
  it('a save in flight when sign-out wipes cannot write back', async () => {
    const saving = saveHomeSnapshot(snap);
    await vi.waitFor(() => expect(h.release).not.toBeNull());
    const clearing = clearHomeSnapshot('a');
    h.release?.();
    await Promise.all([saving, clearing]);
    expect(h.disk.has(snapshotKey('a'))).toBe(false);
  });
  it('a save started after the wipe still persists', async () => {
    const clearing = clearHomeSnapshot('a');
    await clearing;
    h.release = null as null | (() => void);
    const later = saveHomeSnapshot(snap);
    await vi.waitFor(() => expect(h.release).not.toBeNull());
    (h.release as null | (() => void))?.();
    await later;
    expect(h.disk.has(snapshotKey('a'))).toBe(true);
  });
});
