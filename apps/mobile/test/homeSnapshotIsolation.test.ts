import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  parseSnapshot,
  serialiseSnapshot,
  snapshotKey,
  type HomeSnapshot,
} from '../src/lib/homeSnapshot';
import {
  clearHomeSnapshot,
  loadHomeSnapshot,
  saveHomeSnapshot,
} from '../src/lib/homeSnapshotStore';

const h = vi.hoisted(() => ({
  disk: new Map<string, string>(),
  gate: null as null | Promise<void>,
  reads: 0,
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => {
      h.reads++;
      if (h.gate) await h.gate;
      return h.disk.get(k) ?? null;
    },
    removeItem: async (k: string) => void h.disk.delete(k),
    setItem: async (k: string, v: string) => void h.disk.set(k, v),
  },
}));
vi.mock('react', () => ({ useEffect: () => {}, useState: () => [null, () => {}] }));
vi.mock('@/sync/rowCipher', () => ({
  loadKey: async () => new Uint8Array(1),
  encryptWith: (_k: unknown, v: string, ad: string) => `${ad}|${v}`,
  decryptWith: (_k: unknown, v: string, ad: string) => {
    const [bound, ...rest] = v.split('|');
    if (bound !== ad) throw new Error('bad tag');
    return rest.join('|');
  },
}));

const row = { key: 'g', title: 'G', memberLabel: '', amountText: '', directionLabel: '' };
const snap = (viewerId: string, net = '0'): HomeSnapshot => ({
  v: 1,
  viewerId,
  headline: { currency: 'INR', net, owed: '0', owing: '0', owedGroups: 0, owingGroups: 0 },
  needs: [],
  needsTotal: 0,
  comingUp: [],
  personal: row,
  groups: [],
});

// The store caches per owner in module memory, so each test uses its own ids.
let n = 0;
const id = () => `acct-${++n}`;

describe('home snapshot store isolation', () => {
  beforeEach(() => {
    h.disk.clear();
    h.gate = null;
    h.reads = 0;
  });

  it('keeps two accounts apart on disk and in memory', async () => {
    const a = id();
    const b = id();
    await saveHomeSnapshot(snap(a, '111'));
    await saveHomeSnapshot(snap(b, '222'));
    expect((await loadHomeSnapshot(a))?.headline.net).toBe('111');
    expect((await loadHomeSnapshot(b))?.headline.net).toBe('222');
    await clearHomeSnapshot(a);
    expect(await loadHomeSnapshot(a)).toBeNull();
    expect((await loadHomeSnapshot(b))?.headline.net).toBe('222');
  });

  it("a blob stored under another account's key is rejected", async () => {
    const a = id();
    const b = id();
    h.disk.set(snapshotKey(a), `${snapshotKey(a)}|${serialiseSnapshot(snap(b))}`);
    expect(await loadHomeSnapshot(a)).toBeNull();
  });

  it('a blob copied to another key fails the key binding and loads as nothing', async () => {
    const a = id();
    const b = id();
    h.disk.set(snapshotKey(a), `${snapshotKey(b)}|${serialiseSnapshot(snap(a))}`);
    expect(await loadHomeSnapshot(a)).toBeNull();
  });

  it('corrupt stored text loads as null and does not throw', async () => {
    const a = id();
    h.disk.set(snapshotKey(a), `${snapshotKey(a)}|{not json`);
    await expect(loadHomeSnapshot(a)).resolves.toBeNull();
    const c = id();
    h.disk.set(snapshotKey(c), 'garbage-without-binding');
    await expect(loadHomeSnapshot(c)).resolves.toBeNull();
  });

  it('a load already reading when sign-out wipes returns nothing and caches nothing', async () => {
    const a = id();
    h.disk.set(snapshotKey(a), `${snapshotKey(a)}|${serialiseSnapshot(snap(a, '5'))}`);
    let open!: () => void;
    h.gate = new Promise<void>((r) => (open = r));
    const loading = loadHomeSnapshot(a);
    await vi.waitFor(() => expect(h.reads).toBe(1));
    const clearing = clearHomeSnapshot(a);
    open();
    expect(await loading).toBeNull();
    await clearing;
    h.gate = null;
    expect(await loadHomeSnapshot(a)).toBeNull();
  });

  it('a load queued behind a wipe is cancelled by it', async () => {
    const a = id();
    await saveHomeSnapshot(snap(a, '9'));
    const clearing = clearHomeSnapshot(a);
    const loading = loadHomeSnapshot(a);
    await clearing;
    expect(await loading).toBeNull();
  });

  it('serves a second load from memory without touching disk', async () => {
    const a = id();
    h.disk.set(snapshotKey(a), `${snapshotKey(a)}|${serialiseSnapshot(snap(a, '7'))}`);
    await loadHomeSnapshot(a);
    await loadHomeSnapshot(a);
    expect(h.reads).toBe(1);
  });

  it('the last of two quick saves wins', async () => {
    const a = id();
    void saveHomeSnapshot(snap(a, '1'));
    await saveHomeSnapshot(snap(a, '2'));
    expect((await loadHomeSnapshot(a))?.headline.net).toBe('2');
    expect(
      parseSnapshot(h.disk.get(snapshotKey(a))!.split('|').slice(1).join('|'), a)?.headline.net,
    ).toBe('2');
  });
});

describe('home snapshot parsing of masked and odd rows', () => {
  const base = snap('a');
  const text = (p: Partial<HomeSnapshot>) => JSON.stringify({ ...base, ...p });

  it('keeps masked amount text verbatim (masking is a render concern, not stored)', () => {
    const masked = { ...row, amountText: '••••', balance: '-12345', isDemo: false };
    const s = parseSnapshot(text({ groups: [masked] }), 'a');
    expect(s?.groups[0]?.amountText).toBe('••••');
    expect(s?.groups[0]?.balance).toBe('-12345');
  });

  it('rejects non-integer balance text, null rows, and a non-array rows field', () => {
    expect(parseSnapshot(text({ groups: [{ ...row, balance: '12.5' }] }), 'a')).toBeNull();
    expect(parseSnapshot(text({ groups: [null as never] }), 'a')).toBeNull();
    expect(parseSnapshot(text({ needs: {} as never }), 'a')).toBeNull();
    expect(parseSnapshot(text({ personal: 5 as never }), 'a')).toBeNull();
  });

  it('rejects a wrong version, missing headline, and the literal "null" / empty', () => {
    expect(parseSnapshot(text({ v: 2 as never }), 'a')).toBeNull();
    expect(parseSnapshot(text({ headline: undefined as never }), 'a')).toBeNull();
    expect(parseSnapshot('null', 'a')).toBeNull();
    expect(parseSnapshot('', 'a')).toBeNull();
    expect(parseSnapshot(null, 'a')).toBeNull();
  });

  it('accepts a null personal row and tolerates optional extras being null', () => {
    const s = parseSnapshot(
      text({ personal: null, groups: [{ ...row, coverEmoji: null, tag: null }] }),
      'a',
    );
    expect(s?.personal).toBeNull();
  });
});
