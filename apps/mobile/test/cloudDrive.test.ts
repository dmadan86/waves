/**
 * Google Drive as the one place an encrypted backup lives, over plain `fetch`.
 *
 * The native consent flow has its own suite (`driveNativeAuth.test.ts`). This
 * covers the HTTP half: that a stale token is renewed or turned into the same
 * 401 a dead grant produces, that `find` picks the newest file if a past
 * failure ever left two, that an overwrite is a media PATCH while a create is a
 * multipart body carrying the appDataFolder parent, that a delete of something
 * already gone is success, and that every non-2xx carries its status so the
 * engine can tell a dead token from a bad minute of signal.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { googleDrive } from '@/lib/cloud/googleDrive';
import {
  CloudHttpError,
  isAuthFailure,
  requestJson,
  requestRaw,
  requestText,
} from '@/lib/cloud/http';
import { allProviders, providerFor } from '@/lib/cloud/providers';
import { clearTokens, loadTokens, saveTokens } from '@/lib/cloud/tokens';

const h = vi.hoisted(() => ({
  configured: true,
  nativeAvailable: true,
  nativeAuthorize: vi.fn(async (): Promise<unknown> => null),
  nativeReauthorize: vi.fn(async (_t: unknown): Promise<unknown> => null),
  nativeRevoke: vi.fn(async (_t: unknown): Promise<boolean> => false),
  secure: new Map<string, string>(),
  secureFails: false,
}));

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('@/lib/observability', () => ({ reportHandled: vi.fn() }));
vi.mock('@/lib/cloud/config', () => ({ isConfigured: () => h.configured }));
vi.mock('@/lib/cloud/nativeGoogle', () => ({
  nativeAuthAvailable: () => h.nativeAvailable,
  nativeAuthorize: h.nativeAuthorize,
  nativeReauthorize: h.nativeReauthorize,
  nativeRevoke: h.nativeRevoke,
}));
vi.mock('@/lib/secureStorage', () => ({
  secureAuthStorage: {
    getItem: async (key: string) => {
      if (h.secureFails) throw new Error('keystore locked');
      return h.secure.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => {
      if (h.secureFails) throw new Error('keystore locked');
      h.secure.set(key, value);
    },
    removeItem: async (key: string) => void h.secure.delete(key),
  },
}));

interface Call {
  url: string;
  init: RequestInit | undefined;
}
let calls: Call[] = [];
let responses: { status: number; body: string }[] = [];

function respond(status: number, body: unknown = ''): void {
  responses.push({ status, body: typeof body === 'string' ? body : JSON.stringify(body) });
}

const TOKENS = { accessToken: 'at', refreshToken: null, expiresAt: Date.now() + 3_600_000 };

beforeEach(() => {
  calls = [];
  responses = [];
  h.configured = true;
  h.nativeAvailable = true;
  h.secure.clear();
  h.secureFails = false;
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const next = responses.shift() ?? { status: 200, body: '' };
      return {
        ok: next.status >= 200 && next.status < 300,
        status: next.status,
        text: async () => next.body,
      };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('http helpers', () => {
  it('sends JSON and parses the answer', async () => {
    respond(200, { ok: 1 });
    expect(
      await requestJson('https://x/y', { method: 'POST', body: { a: 1 }, headers: { A: 'b' } }),
    ).toEqual({
      ok: 1,
    });
    expect(calls[0]!.init).toMatchObject({
      method: 'POST',
      body: '{"a":1}',
      headers: { 'Content-Type': 'application/json', A: 'b' },
    });
  });

  it('defaults to a bodiless GET', async () => {
    respond(200, '');
    expect(await requestJson('https://x')).toEqual({});
    expect(calls[0]!.init).toMatchObject({ method: 'GET', body: undefined });
  });

  it('keeps a non-JSON body as raw text instead of failing', async () => {
    respond(200, 'plain words');
    expect(await requestRaw('https://x', { method: 'DELETE', headers: {} })).toEqual({
      raw: 'plain words',
    });
  });

  it('throws the status and body for any non-2xx', async () => {
    respond(403, 'forbidden');
    const error = await requestText('https://x', { headers: {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloudHttpError);
    expect(error).toMatchObject({ status: 403, body: 'forbidden' });
    expect(isAuthFailure(error)).toBe(true);

    respond(500, 'x');
    await expect(requestJson('https://x')).rejects.toMatchObject({ status: 500 });
    respond(502, 'x');
    await expect(requestRaw('https://x', { method: 'PUT', headers: {} })).rejects.toMatchObject({
      status: 502,
    });
  });

  it('counts only 401 and 403 as a dead grant', () => {
    expect(isAuthFailure(new CloudHttpError(401, ''))).toBe(true);
    expect(isAuthFailure(new CloudHttpError(500, ''))).toBe(false);
    expect(isAuthFailure(new Error('401'))).toBe(false);
  });

  it('returns the body of a text download', async () => {
    respond(200, 'sealed-bytes');
    expect(await requestText('https://x', { headers: { A: 'b' } })).toBe('sealed-bytes');
  });
});

describe('the registry', () => {
  it('knows Google Drive, and only it', () => {
    expect(providerFor('gdrive')).toBe(googleDrive);
    expect(allProviders()).toEqual([googleDrive]);
  });
});

describe('googleDrive', () => {
  it('is configured only when both a client id and the native module exist', () => {
    expect(googleDrive.isConfigured()).toBe(true);
    h.nativeAvailable = false;
    expect(googleDrive.isConfigured()).toBe(false);
    h.nativeAvailable = true;
    h.configured = false;
    expect(googleDrive.isConfigured()).toBe(false);
  });

  it('connects through the native consent flow', async () => {
    h.nativeAuthorize.mockResolvedValueOnce(TOKENS);
    expect(await googleDrive.connect()).toBe(TOKENS);
  });

  describe('ensureValid', () => {
    it('hands back a token that is still good untouched', async () => {
      expect(await googleDrive.ensureValid(TOKENS)).toBe(TOKENS);
      expect(h.nativeReauthorize).not.toHaveBeenCalled();
    });

    it('asks again for a stale token', async () => {
      const stale = { ...TOKENS, expiresAt: Date.now() - 1 };
      const fresh = { ...TOKENS, accessToken: 'at2' };
      h.nativeReauthorize.mockResolvedValueOnce(fresh);
      expect(await googleDrive.ensureValid(stale)).toBe(fresh);
    });

    it('turns a grant that is gone into a 401', async () => {
      const stale = { ...TOKENS, accessToken: '' };
      h.nativeReauthorize.mockResolvedValueOnce(null);
      const error = await googleDrive.ensureValid(stale).catch((e: unknown) => e);
      expect(isAuthFailure(error)).toBe(true);
    });
  });

  describe('account', () => {
    it('prefers the email, then the display name', async () => {
      respond(200, { user: { emailAddress: 'a@x.com', displayName: 'A' } });
      expect(await googleDrive.account(TOKENS)).toBe('a@x.com');
      expect(calls[0]!.init?.headers).toMatchObject({ Authorization: 'Bearer at' });
      respond(200, { user: { displayName: 'A' } });
      expect(await googleDrive.account(TOKENS)).toBe('A');
      respond(200, {});
      expect(await googleDrive.account(TOKENS)).toBeNull();
    });

    it('swallows a refusal as "unknown"', async () => {
      respond(403, 'insufficient scope');
      expect(await googleDrive.account(TOKENS)).toBeNull();
    });
  });

  describe('find', () => {
    it('searches the appDataFolder, quote-stripped, and returns the newest match', async () => {
      respond(200, {
        files: [
          { id: 'old', name: 'b.json', size: '10', modifiedTime: '2026-01-01T00:00:00Z' },
          { id: 'new', name: 'b.json', size: '20', modifiedTime: '2026-09-01T00:00:00Z' },
          { id: '', name: 'b.json' },
        ],
      });
      const file = await googleDrive.find(TOKENS, "b'.json");
      expect(file).toEqual({
        remoteId: 'new',
        name: 'b.json',
        size: 20,
        modifiedAt: Date.parse('2026-09-01T00:00:00Z'),
      });
      expect(calls[0]!.url).toContain('spaces=appDataFolder');
      expect(decodeURIComponent(calls[0]!.url)).toContain("name='b.json' and trashed=false");
    });

    it('answers null when there is nothing there', async () => {
      respond(200, {});
      expect(await googleDrive.find(TOKENS, 'b.json')).toBeNull();
    });

    it('reads a missing size or time as zero and unknown', async () => {
      respond(200, { files: [{ id: 'f', size: 'n/a' }] });
      expect(await googleDrive.find(TOKENS, 'x')).toEqual({
        remoteId: 'f',
        name: '',
        size: 0,
        modifiedAt: null,
      });
    });
  });

  describe('put', () => {
    it('overwrites an existing file with a media PATCH', async () => {
      respond(200, { id: 'f1', name: 'b.json', size: '5' });
      const file = await googleDrive.put(TOKENS, 'b.json', '{"x":1}', 'f1');
      expect(file.remoteId).toBe('f1');
      expect(calls[0]!.url).toContain('/upload/drive/v3/files/f1?uploadType=media');
      expect(calls[0]!.init).toMatchObject({ method: 'PATCH', body: '{"x":1}' });
    });

    it('creates a new file as one multipart body with the appDataFolder parent', async () => {
      respond(200, { id: 'f2', name: 'b.json' });
      const file = await googleDrive.put(TOKENS, 'b.json', '{"x":1}', null);
      expect(file.remoteId).toBe('f2');
      const init = calls[0]!.init!;
      expect(init.method).toBe('POST');
      const contentType = (init.headers as Record<string, string>)['Content-Type']!;
      const boundary = contentType.split('boundary=')[1]!;
      expect(contentType).toMatch(/^multipart\/related; boundary=/);
      const body = String(init.body);
      expect(body).toContain(`--${boundary}\r\n`);
      expect(body).toContain('{"name":"b.json","parents":["appDataFolder"]}');
      expect(body).toContain('{"x":1}');
      expect(body.endsWith(`--${boundary}--`)).toBe(true);
    });
  });

  it('downloads a file by id', async () => {
    respond(200, 'sealed');
    expect(await googleDrive.read(TOKENS, 'f1')).toBe('sealed');
    expect(calls[0]!.url).toBe('https://www.googleapis.com/drive/v3/files/f1?alt=media');
  });

  describe('remove', () => {
    it('deletes the file', async () => {
      respond(204, '');
      await googleDrive.remove!(TOKENS, 'f1');
      expect(calls[0]!.init).toMatchObject({ method: 'DELETE' });
    });

    it('treats a file already gone as done', async () => {
      respond(404, 'not found');
      await expect(googleDrive.remove!(TOKENS, 'f1')).resolves.toBeUndefined();
    });

    it('rethrows anything else', async () => {
      respond(500, 'oops');
      await expect(googleDrive.remove!(TOKENS, 'f1')).rejects.toMatchObject({ status: 500 });
    });
  });

  describe('revoke', () => {
    it('lets Play services do it when it can', async () => {
      h.nativeRevoke.mockResolvedValueOnce(true);
      await googleDrive.revoke!(TOKENS);
      expect(calls).toEqual([]);
    });

    it('falls back to the HTTP revoke, preferring the refresh token', async () => {
      h.nativeRevoke.mockRejectedValueOnce(new Error('native broke'));
      await googleDrive.revoke!({ ...TOKENS, refreshToken: 'r t' });
      expect(calls[0]!.url).toBe('https://oauth2.googleapis.com/revoke');
      expect(calls[0]!.init?.body).toBe('token=r%20t');

      h.nativeRevoke.mockResolvedValueOnce(false);
      await googleDrive.revoke!(TOKENS);
      expect(calls[1]!.init?.body).toBe('token=at');
    });

    it('has nothing to revoke without a token', async () => {
      await googleDrive.revoke!({ accessToken: '', refreshToken: null, expiresAt: null });
      expect(calls).toEqual([]);
    });
  });
});

describe('stored tokens', () => {
  it('round-trips per account, and forgets on clear', async () => {
    await saveTokens('gdrive', 'alice', TOKENS);
    expect(await loadTokens('gdrive', 'alice')).toEqual(TOKENS);
    expect(await loadTokens('gdrive', 'bob')).toBeNull();
    await clearTokens('gdrive', 'alice');
    expect(await loadTokens('gdrive', 'alice')).toBeNull();
  });

  it('ignores a signed-out caller', async () => {
    await saveTokens('gdrive', '', TOKENS);
    await clearTokens('gdrive', '');
    expect(h.secure.size).toBe(0);
    expect(await loadTokens('gdrive', '')).toBeNull();
  });

  it('reads an unusable blob, or a locked keystore, as not connected', async () => {
    h.secure.set('waves.cloud.tokens.gdrive.alice', '{not json');
    expect(await loadTokens('gdrive', 'alice')).toBeNull();
    h.secure.set('waves.cloud.tokens.gdrive.alice', JSON.stringify({ accessToken: '' }));
    expect(await loadTokens('gdrive', 'alice')).toBeNull();
    h.secure.set(
      'waves.cloud.tokens.gdrive.alice',
      JSON.stringify({ accessToken: 'a', refreshToken: 5 }),
    );
    expect(await loadTokens('gdrive', 'alice')).toEqual({
      accessToken: 'a',
      refreshToken: null,
      expiresAt: null,
    });
    h.secureFails = true;
    expect(await loadTokens('gdrive', 'alice')).toBeNull();
    await expect(saveTokens('gdrive', 'alice', TOKENS)).resolves.toBeUndefined();
  });
});
