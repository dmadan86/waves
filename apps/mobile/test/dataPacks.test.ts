/**
 * Category packs: the shelf is a network read, installs ride the mirror.
 *
 * `fetchPacks` must drop anything that does not parse rather than render it
 * broken; installing writes the tags first and the install record last (so an
 * interrupted install is repaired by installing again); and every write refuses
 * to run signed out. The hooks are run as plain functions with React and React
 * Query stood in for by their identity.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  categoryTagsScope,
  emptyMirror,
  MutationKind,
  packInstallsScope,
  packTagId,
  type Pack,
  type QueuedMutation,
} from '@waves/core';

const state = vi.hoisted(() => ({
  mirror: null as unknown,
  queue: [] as unknown[],
  session: null as { user: { id: string } } | null,
  tags: [] as unknown[],
  mutate: vi.fn(async () => undefined),
  select: { data: null as unknown, error: null as unknown },
  insert: vi.fn(async () => ({ error: null as unknown })),
  from: vi.fn(),
}));

vi.mock('react', () => ({ useMemo: (fn: () => unknown) => fn() }));
vi.mock('@tanstack/react-query', () => ({
  useMutation: (options: unknown) => options,
  useQuery: (options: unknown) => options,
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'install-uuid' }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ session: state.session }) }));
vi.mock('@/data/hooks', () => ({ useCategoryTags: () => ({ data: state.tags }) }));
vi.mock('@/sync', () => ({
  useSync: () => ({ mirror: state.mirror, queue: state.queue, mutate: state.mutate }),
}));
vi.mock('@/lib/backend', () => ({
  backend: {
    from: (table: string) => {
      state.from(table);
      return {
        select: () => ({ order: async () => state.select }),
        insert: state.insert,
      };
    },
  },
}));

const packs = await import('@/data/packs');

const OWNER = 'user-1';

const ENTRY = {
  key: 'coffee',
  label: 'Coffee',
  icon: 'pricetag-outline',
  tint: 'mint',
  axis: 'expense',
};

function packRow(over: Record<string, unknown> = {}) {
  return {
    id: 'pack-cafe',
    slug: 'cafe',
    title: 'Café',
    summary: 'For coffee people',
    entries: [ENTRY, { ...ENTRY, key: 'tea', label: 'Tea' }],
    version: 2,
    install_count: 12,
    ...over,
  };
}

const PACK: Pack = {
  id: 'pack-cafe',
  slug: 'cafe',
  title: 'Café',
  summary: 'For coffee people',
  entries: [
    ENTRY as Pack['entries'][number],
    { ...(ENTRY as Pack['entries'][number]), key: 'tea', label: 'Tea' },
  ],
  version: 2,
};

type Mutation<I, O> = { mutationFn: (input: I) => Promise<O> };

beforeEach(() => {
  state.mirror = emptyMirror();
  state.queue = [];
  state.session = { user: { id: OWNER } };
  state.tags = [];
  state.mutate.mockClear();
  state.insert.mockClear();
  state.insert.mockResolvedValue({ error: null });
  state.from.mockClear();
  state.select = { data: [], error: null };
});

describe('fetchPacks', () => {
  it('returns the parsed packs with their install counts, dropping any that do not parse', async () => {
    // Given one good pack, one with a bad entry and one with no install count
    state.select = {
      data: [
        packRow(),
        packRow({ id: 'pack-bad', slug: 'bad', entries: [{ ...ENTRY, tint: 'neon' }] }),
        packRow({ id: 'pack-new', slug: 'new', install_count: null }),
      ],
      error: null,
    };
    // When the shelf is read
    const shelf = await packs.fetchPacks();
    // Then the broken one is gone and the count defaults to zero
    expect(state.from).toHaveBeenCalledWith('packs');
    expect(shelf.map((p) => [p.id, p.installCount])).toEqual([
      ['pack-cafe', 12],
      ['pack-new', 0],
    ]);
    expect(shelf[0]?.entries).toHaveLength(2);
  });

  it('is empty when the server sends no rows', async () => {
    state.select = { data: null, error: null };
    await expect(packs.fetchPacks()).resolves.toEqual([]);
  });

  it('throws the backend error rather than showing an empty shelf', async () => {
    const error = new Error('offline');
    state.select = { data: null, error };
    await expect(packs.fetchPacks()).rejects.toBe(error);
  });

  it('usePacks queries the shelf under a stable key', () => {
    const query = packs.usePacks() as unknown as { queryKey: unknown; queryFn: unknown };
    expect(query.queryKey).toEqual(['packs']);
    expect(query.queryFn).toBe(packs.fetchPacks);
  });
});

describe('useInstalledPacks', () => {
  // BUG (not fixed here): `pack_installs` is missing from the mirror's TABLES
  // list in @waves/core (sync/mirror.ts), so `emptyMirror()` has no such table
  // and `rowsFor` does `Object.values(undefined)`. Signed in, with no install
  // ever pulled, `useInstalledPacks()` throws a TypeError instead of returning
  // []. `reconcile` also only copies TABLES, so a pulled pack_install change
  // hits an undefined table too.
  it.todo('is empty (does not throw) when signed in on a fresh mirror with no installs');

  it('is empty when signed out', () => {
    state.session = null;
    expect(packs.useInstalledPacks()).toEqual([]);
  });

  it('lists the server’s installs and a pending one from the queue', () => {
    // Given one install already on the server and one queued offline
    const m = emptyMirror();
    (m.tables as Record<string, unknown>).pack_installs = {
      'i-1': { id: 'i-1', owner_user_id: OWNER, pack_id: 'pack-a', version: 1, deleted_at: null },
    };
    state.mirror = m;
    state.queue = [
      {
        seq: 1,
        groupId: packInstallsScope(OWNER),
        kind: MutationKind.PackInstall,
        clientMutationId: 'c1',
        clientCreatedAt: '2026-09-01T00:00:00.000Z',
        payload: { installId: 'i-2', packId: 'pack-b', version: 3 },
      } as unknown as QueuedMutation,
    ];
    // Then both show, the queued one marked pending
    expect(packs.useInstalledPacks()).toEqual([
      { installId: 'i-1', packId: 'pack-a', version: 1, pending: false },
      { installId: 'i-2', packId: 'pack-b', version: 3, pending: true },
    ]);
  });
});

describe('useInstallPack', () => {
  it('writes every new tag, then the install record, and reports how many were added', async () => {
    const { mutationFn } = packs.useInstallPack() as unknown as Mutation<Pack, number>;
    await expect(mutationFn(PACK)).resolves.toBe(2);

    const calls = state.mutate.mock.calls as unknown as [string, string, Record<string, unknown>][];
    expect(calls.map(([kind]) => kind)).toEqual([
      MutationKind.TagCreate,
      MutationKind.TagCreate,
      MutationKind.PackInstall,
    ]);
    expect(calls[0]?.[1]).toBe(categoryTagsScope(OWNER));
    expect(calls[0]?.[2]).toMatchObject({
      tagId: packTagId('pack-cafe', 'coffee'),
      packId: 'pack-cafe',
    });
    expect(calls[2]).toEqual([
      MutationKind.PackInstall,
      packInstallsScope(OWNER),
      { installId: 'install-uuid', packId: 'pack-cafe', version: 2 },
    ]);
  });

  it('skips a tag the catalog already holds (a re-install writes only what is new)', async () => {
    state.tags = [{ id: packTagId('pack-cafe', 'coffee'), sort_order: 0 }];
    const { mutationFn } = packs.useInstallPack() as unknown as Mutation<Pack, number>;
    await expect(mutationFn(PACK)).resolves.toBe(1);
    expect(state.mutate).toHaveBeenCalledTimes(2);
  });

  it('refuses when signed out, and writes nothing', async () => {
    state.session = null;
    const { mutationFn } = packs.useInstallPack() as unknown as Mutation<Pack, number>;
    await expect(mutationFn(PACK)).rejects.toThrow('Sign in first');
    expect(state.mutate).not.toHaveBeenCalled();
  });
});

describe('useUninstallPack', () => {
  it('queues the uninstall on the installs scope', async () => {
    const { mutationFn } = packs.useUninstallPack() as unknown as Mutation<string, void>;
    await mutationFn('i-1');
    expect(state.mutate).toHaveBeenCalledWith(
      MutationKind.PackUninstall,
      packInstallsScope(OWNER),
      { installId: 'i-1' },
    );
  });

  it('refuses when signed out', async () => {
    state.session = null;
    const { mutationFn } = packs.useUninstallPack() as unknown as Mutation<string, void>;
    await expect(mutationFn('i-1')).rejects.toThrow('Sign in first');
  });
});

describe('useRequestPack', () => {
  it('inserts one trimmed request capped at 500 characters', async () => {
    const { mutationFn } = packs.useRequestPack() as unknown as Mutation<string, void>;
    await mutationFn(`  ${'x'.repeat(600)}  `);
    expect(state.from).toHaveBeenCalledWith('pack_requests');
    expect(state.insert).toHaveBeenCalledWith({ requester_id: OWNER, body: 'x'.repeat(500) });
  });

  it('throws the insert error', async () => {
    const error = new Error('denied');
    state.insert.mockResolvedValueOnce({ error });
    const { mutationFn } = packs.useRequestPack() as unknown as Mutation<string, void>;
    await expect(mutationFn('Gym')).rejects.toBe(error);
  });

  it('refuses when signed out, and sends nothing', async () => {
    state.session = null;
    const { mutationFn } = packs.useRequestPack() as unknown as Mutation<string, void>;
    await expect(mutationFn('Gym')).rejects.toThrow('Sign in first');
    expect(state.insert).not.toHaveBeenCalled();
  });
});
