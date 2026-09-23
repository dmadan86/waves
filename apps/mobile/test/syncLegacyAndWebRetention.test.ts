/**
 * Two edges of the local store that hold somebody's unsent work.
 *
 * 1. The `baaki.db` → `waves.db` rename. expo-sqlite names a database after the
 *    string it is opened with, so the rename would have opened an empty file
 *    beside the real one. The file moves first, with its SQLite sidecars, and
 *    only into an empty slot.
 * 2. The web store's retained-work stamp: the owner a held queue belongs to,
 *    which is what stops a shared browser draining one person's queue into
 *    another person's account.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({
  dirExists: true,
  files: new Map<string, boolean>(),
  moves: [] as [string, string][],
  failMove: new Set<string>(),
  throwOnImport: false,
}));

vi.mock('expo-file-system', () => {
  if (fs.throwOnImport) throw new Error('no native module');
  class Directory {
    constructor(
      readonly base: unknown,
      readonly name: string,
    ) {}
    get exists(): boolean {
      return fs.dirExists;
    }
  }
  class File {
    readonly name: string;
    constructor(_dir: Directory, name: string) {
      this.name = name;
    }
    get exists(): boolean {
      return fs.files.get(this.name) ?? false;
    }
    move(to: File): void {
      if (fs.failMove.has(this.name)) throw new Error('EBUSY');
      fs.moves.push([this.name, to.name]);
      fs.files.set(to.name, true);
      fs.files.set(this.name, false);
    }
  }
  return { Directory, File, Paths: { document: 'doc' } };
});

async function freshMigrate() {
  vi.resetModules();
  return (await import('@/sync/legacyDatabase')).migrateLegacyDatabaseFile;
}

beforeEach(() => {
  fs.dirExists = true;
  fs.files.clear();
  fs.moves.length = 0;
  fs.failMove.clear();
  fs.throwOnImport = false;
});

describe('migrateLegacyDatabaseFile', () => {
  it('moves the database and every sidecar it finds to the new name', async () => {
    fs.files.set('baaki.db', true);
    fs.files.set('baaki.db-wal', true);
    fs.files.set('baaki.db-shm', true);
    const migrate = await freshMigrate();
    await migrate();
    expect(fs.moves).toEqual([
      ['baaki.db', 'waves.db'],
      ['baaki.db-wal', 'waves.db-wal'],
      ['baaki.db-shm', 'waves.db-shm'],
    ]);
  });

  it('never moves onto a file that is already there', async () => {
    fs.files.set('baaki.db', true);
    fs.files.set('waves.db', true);
    const migrate = await freshMigrate();
    await migrate();
    expect(fs.moves).toEqual([]);
  });

  it('runs once per launch however often it is asked', async () => {
    fs.files.set('baaki.db', true);
    const migrate = await freshMigrate();
    const first = migrate();
    expect(migrate()).toBe(first);
    await first;
    fs.files.set('baaki.db-journal', true);
    await migrate();
    expect(fs.moves).toEqual([['baaki.db', 'waves.db']]);
  });

  it('keeps moving the rest when one sidecar refuses', async () => {
    fs.files.set('baaki.db', true);
    fs.files.set('baaki.db-wal', true);
    fs.failMove.add('baaki.db');
    const migrate = await freshMigrate();
    await migrate();
    expect(fs.moves).toEqual([['baaki.db-wal', 'waves.db-wal']]);
  });

  it('does nothing when there is no SQLite directory yet', async () => {
    fs.dirExists = false;
    fs.files.set('baaki.db', true);
    const migrate = await freshMigrate();
    await migrate();
    expect(fs.moves).toEqual([]);
  });

  it('never rejects when the filesystem module cannot load', async () => {
    fs.throwOnImport = true;
    const migrate = await freshMigrate();
    await expect(migrate()).resolves.toBeUndefined();
  });
});

describe('web store — retained work', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  async function store() {
    const { createLocalStore } = await import('@/sync/driver.web');
    const s = createLocalStore();
    await s.ready();
    return s;
  }

  it('drops the mirror, keeps the queue, and stamps the owner', async () => {
    const s = await store();
    await s.putRows([{ table: 'expenses', id: 'e1', groupId: 'g1', seq: 1, row: {} }] as never);
    await s.writeCursors({ g1: 1 });
    await s.writeQueue([{ clientMutationId: 'm1' }] as never);

    await s.retainUnsent('alice', '2026-09-01T00:00:00Z');

    expect(await s.readRows()).toEqual([]);
    expect(await s.readCursors()).toEqual({});
    expect(await s.readQueue()).toHaveLength(1);
    expect(await s.readRetained()).toEqual({
      ownerId: 'alice',
      retainedAt: '2026-09-01T00:00:00Z',
    });

    await s.clearRetained();
    expect(await s.readRetained()).toBeNull();
  });

  it('reads a stamp that is not a stamp as nothing held', async () => {
    const s = await store();
    await AsyncStorage.setItem('waves:retained', JSON.stringify({ ownerId: 42 }));
    expect(await s.readRetained()).toBeNull();
    await AsyncStorage.setItem('waves:retained', '{not json');
    expect(await s.readRetained()).toBeNull();
  });

  it('writes nothing for an empty batch of rows', async () => {
    const s = await store();
    const setItem = vi.spyOn(AsyncStorage, 'setItem');
    await s.putRows([]);
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});
