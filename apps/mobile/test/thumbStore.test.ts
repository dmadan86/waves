/**
 * The persistent thumbnail store: a saved thumbnail is drawable at once and
 * survives a restart; leaving a group drops that group's thumbnails; sign-out
 * drops all of them, and a download still in flight cannot bring one back.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({
  files: new Map<string, Uint8Array | string>(),
  dirs: new Set<string>(),
}));

class FakeDirectory {
  readonly uri: string;

  constructor(...parts: unknown[]) {
    this.uri = parts.map((p) => (p instanceof FakeDirectory ? p.uri : String(p))).join('/');
  }

  get exists(): boolean {
    return fs.dirs.has(this.uri);
  }

  create(): void {
    fs.dirs.add(this.uri);
  }

  delete(): void {
    fs.dirs.delete(this.uri);
    for (const key of [...fs.files.keys()]) {
      if (key.startsWith(`${this.uri}/`)) fs.files.delete(key);
    }
  }
}

class FakeFile {
  readonly uri: string;

  constructor(...parts: unknown[]) {
    this.uri = parts.map((p) => (p instanceof FakeDirectory ? p.uri : String(p))).join('/');
  }

  get exists(): boolean {
    return fs.files.has(this.uri);
  }

  write(content: Uint8Array | string): void {
    fs.files.set(this.uri, content);
  }

  textSync(): string {
    const content = fs.files.get(this.uri);
    if (typeof content !== 'string') throw new Error('not text');
    return content;
  }

  moveSync(target: FakeFile): void {
    fs.files.set(target.uri, fs.files.get(this.uri) as Uint8Array | string);
    fs.files.delete(this.uri);
  }

  delete(): void {
    fs.files.delete(this.uri);
  }
}

vi.mock('expo-file-system', () => ({
  Directory: FakeDirectory,
  File: FakeFile,
  Paths: { document: 'doc', cache: 'cache' },
}));

const store = await import('../src/lib/storage/thumbStore');

const bytes = (n: number) => new Uint8Array(n).fill(7);
const image = (path: string, groupId = 'g1') =>
  ({ bucket: 'expense-attachments', path, groupId }) as const;

function thumbFiles(): string[] {
  return [...fs.files.keys()].filter((k) => k.endsWith('.jpg'));
}

beforeEach(() => {
  vi.useFakeTimers();
  fs.files.clear();
  fs.dirs.clear();
  store.resetThumbStoreForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('thumbStore', () => {
  it('saves a thumbnail under the persistent document dir and serves it synchronously', () => {
    const uri = store.saveThumb(image('e1/a.webp'), bytes(10));
    expect(uri).toMatch(/^doc\/image-thumbs\//);
    expect(store.localThumbUri('expense-attachments', 'e1/a.webp')).toBe(uri);
    expect(store.localThumbUri('expense-attachments', 'e1/missing.webp')).toBeNull();
    expect(store.localThumbUri('expense-attachments', null)).toBeNull();
  });

  it('survives a restart through its index', () => {
    const uri = store.saveThumb(image('e1/a.webp'), bytes(10));
    vi.runAllTimers();
    store.resetThumbStoreForTests();
    expect(store.localThumbUri('expense-attachments', 'e1/a.webp')).toBe(uri);
  });

  it('replacing a thumbnail removes the old file', () => {
    store.saveThumb(image('e1/a.webp'), bytes(10));
    vi.advanceTimersByTime(5);
    store.saveThumb(image('e1/a.webp'), bytes(12));
    expect(thumbFiles()).toHaveLength(1);
  });

  it('evicting a group drops only that group’s thumbnails', () => {
    store.saveThumb(image('e1/a.webp', 'g1'), bytes(10));
    store.saveThumb(image('e2/b.webp', 'g2'), bytes(10));
    store.evictGroupThumbs('g1');
    expect(store.localThumbUri('expense-attachments', 'e1/a.webp')).toBeNull();
    expect(store.localThumbUri('expense-attachments', 'e2/b.webp')).not.toBeNull();
    expect(thumbFiles()).toHaveLength(1);
  });

  it('evicting one image drops its thumbnail', () => {
    store.saveThumb(image('e1/a.webp'), bytes(10));
    store.evictThumb('expense-attachments', 'e1/a.webp');
    expect(store.localThumbUri('expense-attachments', 'e1/a.webp')).toBeNull();
    expect(thumbFiles()).toHaveLength(0);
  });

  it('clearing wipes every thumbnail and the index, on disk too', () => {
    store.saveThumb(image('e1/a.webp'), bytes(10));
    vi.runAllTimers();
    store.clearThumbs();
    expect(fs.files.size).toBe(0);
    store.resetThumbStoreForTests();
    expect(store.localThumbUri('expense-attachments', 'e1/a.webp')).toBeNull();
  });

  it('refuses a write from a download that started before the wipe', () => {
    const before = store.thumbGeneration();
    store.clearThumbs();
    expect(store.saveThumb(image('e1/a.webp'), bytes(10), before)).toBeNull();
    expect(thumbFiles()).toHaveLength(0);
  });

  it('starts clean when the index is unreadable', () => {
    fs.dirs.add('doc/image-thumbs');
    fs.files.set('doc/image-thumbs/index.json', 'not json');
    fs.files.set('doc/image-thumbs/orphan.jpg', bytes(3));
    expect(store.localThumbUri('expense-attachments', 'e1/a.webp')).toBeNull();
    expect(fs.files.size).toBe(0);
  });
});
