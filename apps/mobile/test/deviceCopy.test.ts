/**
 * "Download a copy" before sign-out: the snapshot is written to a cache file,
 * offered to the share sheet, and the temporary is gone afterwards whatever
 * the share sheet did.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emptyMirror } from '@waves/core';

const fs = vi.hoisted(() => ({
  files: new Map<string, string>(),
  shareAvailable: true,
  shareError: null as Error | null,
  failDelete: false,
  shared: [] as { uri: string; options: Record<string, unknown>; body: string | undefined }[],
}));

vi.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(dir: string, name: string) {
      this.uri = `${dir}/${name}`;
    }
    get exists() {
      return fs.files.has(this.uri);
    }
    create() {
      fs.files.set(this.uri, '');
    }
    write(body: string) {
      fs.files.set(this.uri, body);
    }
    delete() {
      if (fs.failDelete) throw new Error('busy');
      fs.files.delete(this.uri);
    }
  }
  return { File, Paths: { cache: 'cache:' } };
});
vi.mock('expo-sharing', () => ({
  isAvailableAsync: async () => fs.shareAvailable,
  shareAsync: async (uri: string, options: Record<string, unknown>) => {
    fs.shared.push({ uri, options, body: fs.files.get(uri) });
    if (fs.shareError) throw fs.shareError;
  },
}));

const { saveDeviceCopy } = await import('../src/lib/deviceCopy');

const input = {
  mirror: emptyMirror(),
  queue: [],
  drafts: [],
  ownerId: 'u1',
  dialogTitle: 'Save a copy',
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-01T10:20:30.000Z'));
  fs.files.clear();
  fs.shareAvailable = true;
  fs.shareError = null;
  fs.failDelete = false;
  fs.shared = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('saving a copy of this device', () => {
  it('shares a dated JSON snapshot and deletes the temporary afterwards', async () => {
    const result = await saveDeviceCopy(input);

    expect(result.filename).toBe('waves-device-copy-2026-09-01T10-20-30-000.json');
    expect(result.shared).toBe(true);
    expect(fs.shared).toHaveLength(1);
    const [share] = fs.shared;
    expect(share!.uri).toBe(`cache:/${result.filename}`);
    expect(share!.options).toEqual({
      mimeType: 'application/json',
      dialogTitle: 'Save a copy',
      UTI: 'public.json',
    });
    const body = JSON.parse(share!.body!) as { ownerId: string; exportedAt: string };
    expect(body.ownerId).toBe('u1');
    expect(body.exportedAt).toBe('2026-09-01T10:20:30.000Z');
    expect(result.sizeBytes).toBe(share!.body!.length);
    expect(fs.files.size).toBe(0);
  });

  it('replaces a leftover file of the same name', async () => {
    fs.files.set('cache:/waves-device-copy-2026-09-01T10-20-30-000.json', 'stale');
    await saveDeviceCopy(input);
    expect(fs.shared[0]!.body).not.toBe('stale');
  });

  it('says so when there is no share sheet, and still cleans up', async () => {
    fs.shareAvailable = false;
    const result = await saveDeviceCopy(input);
    expect(result.shared).toBe(false);
    expect(fs.files.size).toBe(0);
  });

  it('deletes the temporary even when sharing fails, and lets the error through', async () => {
    fs.shareError = new Error('share sheet crashed');
    await expect(saveDeviceCopy(input)).rejects.toThrow('share sheet crashed');
    expect(fs.files.size).toBe(0);
  });

  it('does not fail the copy when the cleanup cannot delete the file', async () => {
    // With nothing left over, the only delete is the cleanup — and it throws.
    fs.failDelete = true;
    await expect(saveDeviceCopy(input)).resolves.toMatchObject({ shared: true });
  });
});
