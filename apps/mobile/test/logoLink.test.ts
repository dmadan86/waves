import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  checkLogoHeaders,
  downloadLogo,
  LOGO_TIMEOUT_MS,
  MAX_LOGO_BYTES,
  parseLogoUrl,
  sniffImage,
} from '../src/lib/logoLink';

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const jpeg = new Uint8Array([255, 216, 255]);
const webp = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]);
const image = (bytes = png, mime = 'image/png') =>
  new Response(new Uint8Array(bytes).buffer, { headers: { 'content-type': mime } });
const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });
const fetcher = (...responses: Response[]) =>
  vi.fn<typeof fetch>().mockImplementation(async () => responses.shift()!);

afterEach(() => vi.useRealTimers());

describe('parsing a logo link', () => {
  it('trims links and supplies HTTPS only for a missing scheme', () => {
    expect(parseLogoUrl(' example.com/logo.png ')).toEqual({
      ok: true,
      url: 'https://example.com/logo.png',
    });
    expect(parseLogoUrl('https://example.com/logo.png')).toEqual({
      ok: true,
      url: 'https://example.com/logo.png',
    });
    expect(parseLogoUrl('http://example.com')).toEqual({ ok: false, error: 'not_https' });
    expect(parseLogoUrl('ftp://example.com')).toEqual({ ok: false, error: 'not_https' });
    expect(parseLogoUrl('  ')).toEqual({ ok: false, error: 'empty' });
    expect(parseLogoUrl('https://[')).toEqual({ ok: false, error: 'invalid' });
  });

  it.each([
    'localhost',
    'localhost.',
    'a.local',
    'a.internal',
    '127.0.0.1',
    '127.1',
    '10.2.3.4',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.2.1',
    '169.254.2.1',
    '0.0.0.0',
    '[::1]',
    '[0:0:0:0:0:0:0:1]',
    '[fc00::1]',
    '[fdff::1]',
    '[fe80::1]',
    '[::ffff:127.0.0.1]',
    '[2001:db8::1]',
    '[febf::1]',
    'user:password@example.com',
  ])('blocks %s', (host) => {
    expect(parseLogoUrl(`https://${host}/logo`)).toEqual({ ok: false, error: 'blocked_host' });
  });

  it.each(['172.15.0.1', '172.32.0.1', '192.169.0.1', 'example.com'])('accepts %s', (host) => {
    expect(parseLogoUrl(`https://${host}/logo`).ok).toBe(true);
  });
});

describe('logo headers and signatures', () => {
  it.each(['image/png', 'image/jpeg', 'image/webp', 'IMAGE/PNG; charset=binary'])(
    'accepts %s',
    (contentType) => {
      expect(
        checkLogoHeaders({ status: 200, contentType, contentLength: MAX_LOGO_BYTES }),
      ).toBeNull();
    },
  );

  it('refuses HTTP errors, SVG, GIF, other content and declared oversize', () => {
    expect(checkLogoHeaders({ status: 404, contentType: 'image/png' })).toBe('http');
    expect(checkLogoHeaders({ status: 200, contentType: 'image/svg+xml; charset=utf-8' })).toBe(
      'svg',
    );
    for (const contentType of ['image/gif', 'text/html', null]) {
      expect(checkLogoHeaders({ status: 200, contentType })).toBe('not_image');
    }
    expect(
      checkLogoHeaders({
        status: 200,
        contentType: 'image/png',
        contentLength: String(MAX_LOGO_BYTES + 1),
      }),
    ).toBe('too_large');
  });

  it('recognizes only the supported magic bytes', () => {
    expect(sniffImage(png)).toBe('png');
    expect(sniffImage(jpeg)).toBe('jpeg');
    expect(sniffImage(webp)).toBe('webp');
    for (const bytes of [
      new Uint8Array(),
      png.slice(0, 7),
      webp.slice(0, 11),
      new TextEncoder().encode('<svg/>'),
    ]) {
      expect(sniffImage(bytes)).toBeNull();
    }
  });
});

describe('downloading a logo on the phone', () => {
  it('follows three validated redirects and omits credentials', async () => {
    const fetchImpl = fetcher(
      redirect('/one'),
      redirect('https://other.example/two'),
      redirect('/three'),
      image(),
    );
    expect(await downloadLogo('example.com/logo', { fetchImpl })).toEqual({
      ok: true,
      bytes: png,
      mime: 'image/png',
    });
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      'https://example.com/logo',
      'https://example.com/one',
      'https://other.example/two',
      'https://other.example/three',
    ]);
    for (const [, options] of fetchImpl.mock.calls) {
      expect(options).toMatchObject({
        redirect: 'manual',
        credentials: 'omit',
        headers: { Accept: 'image/png,image/jpeg,image/webp' },
      });
    }
  });

  it('refuses a fourth redirect', async () => {
    const fetchImpl = fetcher(...Array.from({ length: 4 }, () => redirect('/next')));
    expect(await downloadLogo('example.com', { fetchImpl })).toEqual({
      ok: false,
      error: 'too_many_redirects',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it.each([
    ['http://example.com/logo', 'not_https'],
    ['https://10.0.0.1/logo', 'blocked_host'],
  ])('refuses redirect to %s', async (location, error) => {
    const fetchImpl = fetcher(redirect(location));
    expect(await downloadLogo('example.com', { fetchImpl })).toEqual({ ok: false, error });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refuses SVG and lying image headers', async () => {
    for (const [response, error] of [
      [image(png, 'image/svg+xml'), 'svg'],
      [image(new TextEncoder().encode('<html/>')), 'not_image'],
      [image(jpeg, 'image/png'), 'not_image'],
    ] as const) {
      expect(await downloadLogo('example.com', { fetchImpl: fetcher(response) })).toEqual({
        ok: false,
        error,
      });
    }
  });

  it.each([
    [jpeg, 'image/jpeg'],
    [webp, 'image/webp'],
  ] as const)('downloads supported bytes %s', async (bytes, mime) => {
    expect(await downloadLogo('example.com', { fetchImpl: fetcher(image(bytes, mime)) })).toEqual({
      ok: true,
      bytes,
      mime,
    });
  });

  it('aborts an oversized stream', async () => {
    const fetchImpl = fetcher(image(new Uint8Array(MAX_LOGO_BYTES + 1)));
    expect(await downloadLogo('example.com', { fetchImpl })).toEqual({
      ok: false,
      error: 'too_large',
    });
    expect(fetchImpl.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it('checks actual size with the arrayBuffer fallback', async () => {
    const response = image(new Uint8Array(MAX_LOGO_BYTES + 1));
    Object.defineProperty(response, 'body', { value: null });
    expect(await downloadLogo('example.com', { fetchImpl: fetcher(response) })).toEqual({
      ok: false,
      error: 'too_large',
    });
  });

  it.each(['opaqueredirect', 'default'])('refuses an unreadable %s redirect', async (type) => {
    const opaque = new Response(null);
    Object.defineProperties(opaque, { type: { value: type }, status: { value: 0 } });
    const fetchImpl = fetcher(opaque);
    expect(await downloadLogo('example.com', { fetchImpl })).toEqual({
      ok: false,
      error: 'network',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('times out through the abort signal', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error(), { name: 'AbortError' })),
          );
        }),
    );
    const result = downloadLogo('example.com', { fetchImpl });
    await vi.advanceTimersByTimeAsync(LOGO_TIMEOUT_MS);
    expect(await result).toEqual({ ok: false, error: 'timeout' });
  });

  it('shares the timeout across redirects and body reading', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 6000));
        return redirect('/logo');
      })
      .mockImplementationOnce(
        async (_url, options) =>
          ({
            status: 200,
            headers: new Headers({ 'content-type': 'image/png' }),
            arrayBuffer: () =>
              new Promise((_resolve, reject) => {
                options?.signal?.addEventListener('abort', () =>
                  reject(Object.assign(new Error(), { name: 'AbortError' })),
                );
              }),
          }) as Response,
      );
    const result = downloadLogo('example.com', { fetchImpl });
    await vi.advanceTimersByTimeAsync(LOGO_TIMEOUT_MS);
    expect(await result).toEqual({ ok: false, error: 'timeout' });
  });

  it('maps network failures without exposing the link', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('secret URL'));
    expect(await downloadLogo('example.com', { fetchImpl })).toEqual({
      ok: false,
      error: 'network',
    });
  });
});
