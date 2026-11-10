/**
 * ota: the expo-updates server. Drives the handler with an in-memory "bucket"
 * and checks the wire format the client parses: multipart/mixed, the response
 * headers, asset objects, runtime/platform/channel matching, the no-update
 * answers, and the RSA signature.
 */

import { createVerify, generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { handleOta, type OtaDeps } from './handler.ts';

const UPDATE_ID = '11111111-2222-4333-8444-555555555555';
const FOLDER = '99999999-2222-4333-8444-555555555555';
const ROOT = 'ota/1.3.1';

const bucket: Record<string, unknown> = {
  [`${ROOT}/production/android/latest.json`]: {
    updateId: UPDATE_ID,
    folder: FOLDER,
    createdAt: '2026-11-10T10:00:00.000Z',
  },
  [`${ROOT}/${FOLDER}/metadata.json`]: {
    fileMetadata: {
      android: {
        bundle: '_expo/static/js/android/entry-abc.hbc',
        assets: [{ path: 'assets/deadbeef', ext: 'png' }],
      },
      ios: { bundle: '_expo/static/js/ios/entry-def.hbc', assets: [] },
    },
    hashes: {
      '_expo/static/js/android/entry-abc.hbc': 'bundleHash',
      'assets/deadbeef': 'assetHash',
    },
  },
  [`${ROOT}/${FOLDER}/expoConfig.json`]: { name: 'Waves', version: '1.3.1' },
};

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const pkcs1 = privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;

function deps(extra: Partial<OtaDeps> = {}): OtaDeps {
  return {
    getJson: (key) => Promise.resolve(bucket[key] ?? null),
    assetUrl: (key) => Promise.resolve(`https://cdn.test/${key}`),
    ...extra,
  };
}

function ask(headers: Record<string, string> = {}, d: OtaDeps = deps()) {
  return handleOta(
    new Request('https://x.test/functions/v1/ota', {
      headers: {
        'expo-protocol-version': '1',
        'expo-platform': 'android',
        'expo-runtime-version': '1.3.1',
        'expo-channel-name': 'production',
        ...headers,
      },
    }),
    d,
  );
}

/** The one part of a multipart response: its headers and parsed JSON body. */
async function part(response: Response) {
  const mark = /boundary=(.+)$/.exec(response.headers.get('content-type') ?? '')![1];
  const text = await response.text();
  const [head, body] = text.split(`--${mark}\r\n`)[1].split('\r\n\r\n');
  const content = body.slice(0, body.indexOf(`\r\n--${mark}`));
  return { head, content, json: JSON.parse(content) };
}

describe('ota manifest', () => {
  it('answers with a multipart manifest and the protocol headers', async () => {
    const response = await ask();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^multipart\/mixed; boundary=/);
    expect(response.headers.get('expo-protocol-version')).toBe('1');
    expect(response.headers.get('expo-sfv-version')).toBe('0');
    expect(response.headers.get('cache-control')).toBe('private, max-age=0');
    expect(response.headers.get('expo-manifest-filters')).toBe('expo-channel-name="production"');
    expect(response.headers.has('expo-server-defined-headers')).toBe(true);

    const { head, json } = await part(response);
    expect(head).toContain('name="manifest"');
    expect(head).toContain('content-type: application/json');
    expect(json).toEqual({
      id: UPDATE_ID,
      createdAt: '2026-11-10T10:00:00.000Z',
      runtimeVersion: '1.3.1',
      launchAsset: {
        hash: 'bundleHash',
        key: 'entry-abc.hbc',
        contentType: 'application/javascript',
        url: `https://cdn.test/${ROOT}/${FOLDER}/_expo/static/js/android/entry-abc.hbc`,
      },
      assets: [
        {
          hash: 'assetHash',
          key: 'deadbeef',
          contentType: 'image/png',
          fileExtension: '.png',
          url: `https://cdn.test/${ROOT}/${FOLDER}/assets/deadbeef`,
        },
      ],
      metadata: { 'expo-channel-name': 'production' },
      extra: { expoClient: { name: 'Waves', version: '1.3.1' } },
    });
  });

  it('is not signed unless the client expects it', async () => {
    const { head } = await part(await ask({}, deps({ privateKey: pkcs1 })));
    expect(head).not.toContain('expo-signature');
  });
});

describe('ota matching', () => {
  it('has nothing for another runtime version (directive on v1, 204 on v0)', async () => {
    const v1 = await ask({ 'expo-runtime-version': '9.9.9' });
    expect((await part(v1)).json).toEqual({ type: 'noUpdateAvailable' });
    const v0 = await ask({ 'expo-runtime-version': '9.9.9', 'expo-protocol-version': '0' });
    expect(v0.status).toBe(204);
  });

  it('has nothing for a platform or channel with no pointer', async () => {
    expect((await part(await ask({ 'expo-platform': 'ios' }))).json.type).toBe('noUpdateAvailable');
    expect((await part(await ask({ 'expo-channel-name': 'preview' }))).json.type).toBe(
      'noUpdateAvailable',
    );
  });

  it('says noUpdateAvailable when the device already runs the latest update', async () => {
    const response = await ask({ 'expo-current-update-id': UPDATE_ID.toUpperCase() });
    const { head, json } = await part(response);
    expect(head).toContain('name="directive"');
    expect(json).toEqual({ type: 'noUpdateAvailable' });
  });

  it('rejects an unsupported platform, a path-like runtime and a bad channel', async () => {
    expect((await ask({ 'expo-platform': 'web' })).status).toBe(400);
    expect((await ask({ 'expo-runtime-version': '../x' })).status).toBe(400);
    expect((await ask({ 'expo-channel-name': 'a/b' })).status).toBe(400);
  });

  it('refuses anything but GET', async () => {
    const response = await handleOta(new Request('https://x.test/ota', { method: 'POST' }), deps());
    expect(response.status).toBe(405);
  });
});

describe('ota signing', () => {
  for (const [label, pem] of [
    ['PKCS#1', pkcs1],
    ['PKCS#8', pkcs8],
  ] as const) {
    it(`signs the manifest part with a ${label} key`, async () => {
      const { head, content } = await part(
        await ask({ 'expo-expect-signature': 'sig' }, deps({ privateKey: pem })),
      );
      const match = /expo-signature: sig="([^"]+)", keyid="main", alg="rsa-v1_5-sha256"/.exec(head);
      expect(match).not.toBeNull();
      const verify = createVerify('RSA-SHA256').update(content);
      expect(verify.verify(publicKey, match![1], 'base64')).toBe(true);
    });
  }

  it('signs directives too', async () => {
    const { head } = await part(
      await ask(
        { 'expo-expect-signature': 'sig', 'expo-current-update-id': UPDATE_ID },
        deps({ privateKey: pkcs1 }),
      ),
    );
    expect(head).toContain('expo-signature: sig=');
  });

  it('fails loudly when the client expects a signature and no key is set', async () => {
    expect((await ask({ 'expo-expect-signature': 'sig' })).status).toBe(500);
  });
});
