import { beforeEach, describe, expect, it, vi } from 'vitest';

const sharing = vi.hoisted(() => ({
  available: true,
  share: vi.fn(async () => undefined),
}));

const fs = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
  failDelete: false,
}));

class FakeFile {
  readonly uri: string;

  constructor(...parts: string[]) {
    this.uri = parts.join('/');
  }

  get exists(): boolean {
    return fs.files.has(this.uri);
  }

  create(): void {
    fs.files.set(this.uri, new Uint8Array());
  }

  write(bytes: Uint8Array): void {
    fs.files.set(this.uri, new Uint8Array(bytes));
  }

  delete(): void {
    if (fs.failDelete) throw new Error('delete failed');
    fs.files.delete(this.uri);
  }
}

vi.mock('expo-sharing', () => ({
  isAvailableAsync: vi.fn(async () => sharing.available),
  shareAsync: sharing.share,
}));

vi.mock('expo-file-system', () => ({
  File: FakeFile,
  Paths: { cache: 'cache-root' },
}));

const { saveImageToDevice } = await import('../src/lib/saveImage');

beforeEach(() => {
  fs.files.clear();
  fs.failDelete = false;
  sharing.available = true;
  sharing.share.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })),
  );
});

describe('saveImageToDevice', () => {
  it('deletes the temporary receipt file after the share sheet returns', async () => {
    await expect(saveImageToDevice('https://signed.example/receipt')).resolves.toBe('shared');

    expect(sharing.share).toHaveBeenCalledWith('cache-root/receipt.png', {
      mimeType: 'image/png',
      dialogTitle: 'Save receipt',
    });
    expect(fs.files.has('cache-root/receipt.png')).toBe(false);
  });

  it('still reports shared when best-effort temp cleanup fails', async () => {
    fs.failDelete = true;

    await expect(saveImageToDevice('https://signed.example/receipt')).resolves.toBe('shared');
    expect(fs.files.has('cache-root/receipt.png')).toBe(true);
  });

  it.each([
    ['image/webp', 'webp'],
    ['image/heic', 'heic'],
    ['image/jpeg', 'jpg'],
    [null, 'jpg'],
  ])('names a %s download with a .%s extension', async (contentType, ext) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => contentType },
        arrayBuffer: async () => new Uint8Array([1]).buffer,
      })),
    );

    await expect(saveImageToDevice('https://signed.example/r')).resolves.toBe('shared');

    expect(sharing.share).toHaveBeenCalledWith(`cache-root/receipt.${ext}`, {
      mimeType: contentType ?? 'image/jpeg',
      dialogTitle: 'Save receipt',
    });
  });

  it('replaces a leftover file of the same name rather than failing on it', async () => {
    fs.files.set('cache-root/receipt.png', new Uint8Array([9, 9]));

    await expect(saveImageToDevice('https://signed.example/receipt')).resolves.toBe('shared');
    expect(sharing.share).toHaveBeenCalledTimes(1);
  });

  it('says unavailable, and fetches nothing, where there is no share sheet', async () => {
    sharing.available = false;

    await expect(saveImageToDevice('https://signed.example/receipt')).resolves.toBe('unavailable');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports an error for a refused fetch or an empty body, and shares nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, headers: { get: () => null } })),
    );
    await expect(saveImageToDevice('https://signed.example/expired')).resolves.toBe('error');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () => new ArrayBuffer(0),
      })),
    );
    await expect(saveImageToDevice('https://signed.example/empty')).resolves.toBe('error');

    expect(sharing.share).not.toHaveBeenCalled();
  });

  it('deletes the temp file when sharing throws, then returns error', async () => {
    sharing.share.mockRejectedValueOnce(new Error('share failed'));

    await expect(saveImageToDevice('https://signed.example/receipt')).resolves.toBe('error');
    expect(fs.files.has('cache-root/receipt.png')).toBe(false);
  });
});
