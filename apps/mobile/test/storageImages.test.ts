/**
 * The one seam every stored image goes through (A44), on both backends.
 *
 * With R2 off it must be exactly the old direct Supabase Storage call, so the
 * seam is safe to ship before any R2 secret exists. With R2 on, a write is a
 * presigned PUT bracketed by `r2-sign` calls — and a PUT that never lands must
 * release the bytes it reserved against the free-tier cap, or a network blip
 * leaks storage until the sweep. The cap refusal itself comes back as a
 * `StorageCapError`, the one failure a person can act on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  imageUrl,
  putImage,
  r2Enabled,
  removeImage,
  restrictedImageUrl,
  StorageCapError,
} from '@/lib/storage';
import { signedUrls } from '@/lib/signedUrlCache';

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  upload: vi.fn(),
  createSignedUrl: vi.fn(),
  remove: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/lib/backend', () => ({
  backend: {
    functions: { invoke: h.invoke },
    storage: { from: h.from },
  },
  backendConfigured: true,
}));

const ORIGINAL = process.env.EXPO_PUBLIC_R2_ENABLED;
const BASE64 = Buffer.from('image-bytes').toString('base64');

let fetchCalls: { url: string; init: RequestInit }[] = [];
let fetchImpl: () => Promise<{ ok: boolean; status: number }>;

/** What supabase-js hands back for a non-2xx function call. */
function functionError(body: unknown) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const response = {
    json: async () => JSON.parse(text),
    clone: () => response,
  };
  return Object.assign(new Error('Edge Function returned a non-2xx status code'), {
    context: response,
  });
}

const actions = () =>
  h.invoke.mock.calls.map(([, { body }]) => (body as { action: string }).action);

beforeEach(() => {
  vi.clearAllMocks();
  signedUrls.clear();
  h.from.mockReturnValue({
    upload: h.upload,
    createSignedUrl: h.createSignedUrl,
    remove: h.remove,
  });
  h.upload.mockResolvedValue({ error: null });
  h.remove.mockResolvedValue({ error: null });
  h.createSignedUrl.mockResolvedValue({
    data: { signedUrl: 'https://supabase/signed' },
    error: null,
  });
  fetchCalls = [];
  fetchImpl = async () => ({ ok: true, status: 200 });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      fetchCalls.push({ url, init });
      return fetchImpl();
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL === undefined) delete process.env.EXPO_PUBLIC_R2_ENABLED;
  else process.env.EXPO_PUBLIC_R2_ENABLED = ORIGINAL;
});

describe('with R2 off — the old direct Supabase calls', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_R2_ENABLED = 'false';
  });

  it('reports R2 as off', () => {
    expect(r2Enabled()).toBe(false);
  });

  it('uploads straight to the bucket, upserting, and returns the path unchanged', async () => {
    const path = await putImage({
      bucket: 'avatars',
      path: 'me/a.webp',
      base64: BASE64,
      contentType: 'image/webp',
    });
    expect(path).toBe('me/a.webp');
    expect(h.from).toHaveBeenCalledWith('avatars');
    expect(h.upload).toHaveBeenCalledWith('me/a.webp', expect.any(ArrayBuffer), {
      contentType: 'image/webp',
      upsert: true,
    });
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it('throws the storage error message', async () => {
    h.upload.mockResolvedValue({ error: { message: 'bucket full' } });
    await expect(
      putImage({ bucket: 'avatars', path: 'x', base64: BASE64, contentType: 'image/webp' }),
    ).rejects.toThrow('bucket full');
  });

  it('refuses a private attachment, which only R2 can hold', async () => {
    await expect(
      putImage({
        bucket: 'settlement-proofs',
        path: 'x',
        base64: BASE64,
        contentType: 'image/webp',
        subjectId: 's',
      }),
    ).rejects.toThrow(/cloud storage/);
  });

  it('signs a URL, once per object, and answers null on failure or no path', async () => {
    expect(await imageUrl('avatars', 'p1')).toBe('https://supabase/signed');
    expect(await imageUrl('avatars', 'p1')).toBe('https://supabase/signed');
    expect(h.createSignedUrl).toHaveBeenCalledTimes(1);

    h.createSignedUrl.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    expect(await imageUrl('avatars', 'p2')).toBeNull();
    h.createSignedUrl.mockResolvedValueOnce({ data: null, error: null });
    expect(await imageUrl('avatars', 'p3')).toBeNull();
    expect(await imageUrl('avatars', null)).toBeNull();
  });

  it('removes from the bucket, and throws when the delete fails', async () => {
    await removeImage('avatars', 'p1');
    expect(h.remove).toHaveBeenCalledWith(['p1']);
    h.remove.mockResolvedValueOnce({ error: { message: 'locked' } });
    await expect(removeImage('avatars', 'p1')).rejects.toThrow('locked');
    await removeImage('avatars', null);
    expect(h.remove).toHaveBeenCalledTimes(2);
  });

  it('has no restricted URL to give', async () => {
    expect(await restrictedImageUrl('settlement-proofs', 's1', 'p')).toBeNull();
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it('drops a cached URL when the object is overwritten', async () => {
    await imageUrl('avatars', 'cover');
    await putImage({ bucket: 'avatars', path: 'cover', base64: BASE64, contentType: 'image/webp' });
    await imageUrl('avatars', 'cover');
    expect(h.createSignedUrl).toHaveBeenCalledTimes(2);
  });
});

describe('with R2 on — presigned, brokered by r2-sign', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_R2_ENABLED = 'true';
  });

  it('asks for a PUT URL, uploads the bytes there, then commits', async () => {
    h.invoke.mockResolvedValue({ data: { url: 'https://r2/put' }, error: null });
    const path = await putImage({
      bucket: 'group-photos',
      path: 'g1/cover.webp',
      base64: BASE64,
      contentType: 'image/webp',
      groupId: 'g1',
    });
    expect(path).toBe('g1/cover.webp');
    expect(actions()).toEqual(['put', 'commit']);
    expect(h.invoke.mock.calls[0]![1].body).toMatchObject({
      bucket: 'group-photos',
      contentLength: 'image-bytes'.length,
      groupId: 'g1',
      subjectId: null,
    });
    expect(fetchCalls[0]!.url).toBe('https://r2/put');
    expect(fetchCalls[0]!.init).toMatchObject({
      method: 'PUT',
      headers: { 'content-type': 'image/webp' },
    });
  });

  it('needs a subject for a private attachment', async () => {
    await expect(
      putImage({
        bucket: 'expense-attachments',
        path: 'x',
        base64: BASE64,
        contentType: 'image/webp',
      }),
    ).rejects.toThrow(/subject/);
  });

  it('fails when no upload URL comes back', async () => {
    h.invoke.mockResolvedValue({ data: null, error: null });
    await expect(
      putImage({ bucket: 'receipts', path: 'x', base64: BASE64, contentType: 'image/webp' }),
    ).rejects.toThrow('Could not start the upload');
  });

  it('releases the reservation when R2 refuses the PUT', async () => {
    h.invoke.mockResolvedValue({ data: { url: 'https://r2/put' }, error: null });
    fetchImpl = async () => ({ ok: false, status: 403 });
    await expect(
      putImage({ bucket: 'receipts', path: 'x', base64: BASE64, contentType: 'image/webp' }),
    ).rejects.toThrow('Upload failed (403)');
    expect(actions()).toEqual(['put', 'release']);
  });

  it('releases the reservation when the PUT never reaches R2, even if the release fails', async () => {
    h.invoke
      .mockResolvedValueOnce({ data: { url: 'https://r2/put' }, error: null })
      .mockRejectedValueOnce(new Error('still offline'));
    fetchImpl = async () => {
      throw new Error('network down');
    };
    await expect(
      putImage({ bucket: 'receipts', path: 'x', base64: BASE64, contentType: 'image/webp' }),
    ).rejects.toThrow('Upload failed: network down');
    expect(actions()).toEqual(['put', 'release']);
  });

  it('says "network error" for a PUT that failed with no Error', async () => {
    h.invoke.mockResolvedValue({ data: { url: 'https://r2/put' }, error: null });
    fetchImpl = () => Promise.reject('offline');
    await expect(
      putImage({ bucket: 'receipts', path: 'x', base64: BASE64, contentType: 'image/webp' }),
    ).rejects.toThrow('Upload failed: network error');
  });

  it('turns a STORAGE_CAP refusal into a StorageCapError', async () => {
    h.invoke.mockResolvedValue({
      data: null,
      error: functionError({ code: 'STORAGE_CAP', message: 'Out of space' }),
    });
    const error = await putImage({
      bucket: 'receipts',
      path: 'x',
      base64: BASE64,
      contentType: 'image/webp',
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorageCapError);
    expect((error as Error).message).toBe('Out of space');
  });

  it("uses the server's message for other refusals, and a generic one when it has none", async () => {
    h.invoke.mockResolvedValueOnce({
      data: null,
      error: functionError({ message: 'NOT_A_PARTY' }),
    });
    await expect(
      putImage({ bucket: 'receipts', path: 'x', base64: BASE64, contentType: 'image/webp' }),
    ).rejects.toThrow('NOT_A_PARTY');

    h.invoke.mockResolvedValueOnce({ data: null, error: functionError('<html>') });
    await expect(
      putImage({ bucket: 'receipts', path: 'x', base64: BASE64, contentType: 'image/webp' }),
    ).rejects.toThrow('Edge Function returned');

    h.invoke.mockResolvedValueOnce({ data: null, error: { weird: true } });
    await expect(
      putImage({ bucket: 'receipts', path: 'x', base64: BASE64, contentType: 'image/webp' }),
    ).rejects.toThrow('Storage request failed');
  });

  it('keeps the default cap message when the server gives none', () => {
    expect(new StorageCapError().message).toMatch(/free storage limit/);
  });

  it('resolves a URL through the function, null on any failure', async () => {
    h.invoke.mockResolvedValueOnce({ data: { url: 'https://r2/get' }, error: null });
    expect(await imageUrl('avatars', 'r1')).toBe('https://r2/get');
    h.invoke.mockResolvedValueOnce({ data: {}, error: null });
    expect(await imageUrl('avatars', 'r2')).toBeNull();
    h.invoke.mockRejectedValueOnce(new Error('offline'));
    expect(await imageUrl('avatars', 'r3')).toBeNull();
  });

  it('resolves a restricted object by subject, never throwing', async () => {
    h.invoke.mockResolvedValueOnce({ data: { url: 'https://r2/proof' }, error: null });
    expect(await restrictedImageUrl('settlement-proofs', 's1', 'p')).toBe('https://r2/proof');
    expect(h.invoke.mock.calls[0]![1].body).toEqual({
      action: 'get',
      bucket: 'settlement-proofs',
      subjectId: 's1',
      path: 'p',
    });
    h.invoke.mockResolvedValueOnce({ data: {}, error: null });
    expect(await restrictedImageUrl('settlement-proofs', 's1', 'p')).toBeNull();
    h.invoke.mockRejectedValueOnce(new Error('offline'));
    expect(await restrictedImageUrl('settlement-proofs', 's1', 'p')).toBeNull();
    expect(await restrictedImageUrl('settlement-proofs', null, 'p')).toBeNull();
    expect(await restrictedImageUrl('settlement-proofs', 's1', null)).toBeNull();
  });

  it('deletes through the function, and lets a failure through', async () => {
    h.invoke.mockResolvedValueOnce({ data: {}, error: null });
    await removeImage('avatars', 'p1');
    expect(actions()).toEqual(['delete']);
    h.invoke.mockResolvedValueOnce({ data: null, error: new Error('denied') });
    await expect(removeImage('avatars', 'p1')).rejects.toThrow('denied');
  });
});
