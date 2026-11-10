/**
 * ota: the expo-updates server. Drives the handler with an in-memory "bucket"
 * and checks the wire format the client parses: multipart/mixed, the response
 * headers, runtime/platform/channel matching, the no-update answers, and that
 * the manifest and its signature are served exactly as the publisher stored
 * them (the function holds no key and builds nothing).
 */

import { createSign, createVerify, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { handleOta, NO_UPDATE_DIRECTIVE, type OtaDeps } from './handler.ts';

const UPDATE_ID = '11111111-2222-4333-8444-555555555555';
const DIR = 'ota/1.3.1/production/android';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const sign = (text: string) => createSign('RSA-SHA256').update(text).sign(privateKey, 'base64');

// Deliberately not canonical JSON: spacing and key order must survive verbatim.
const MANIFEST = `{ "id": "${UPDATE_ID}",  "runtimeVersion":"1.3.1", "launchAsset": {"hash":"h","key":"k","contentType":"application/javascript","url":"https://cdn.test/x.hbc"}, "assets": [], "metadata": {"expo-channel-name":"production"}, "extra": {"expoClient": {}} }`;

const bucket: Record<string, string> = {
  [`${DIR}/latest.json`]: JSON.stringify({ updateId: UPDATE_ID }),
  [`${DIR}/${UPDATE_ID}/manifest.json`]: MANIFEST,
  [`${DIR}/${UPDATE_ID}/manifest.sig`]: sign(MANIFEST) + '\n',
  [`${DIR}/directive.sig`]: sign(NO_UPDATE_DIRECTIVE),
};

const deps: OtaDeps = { getText: (key) => Promise.resolve(bucket[key] ?? null) };

function ask(headers: Record<string, string> = {}, d: OtaDeps = deps) {
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

/** The one part of a multipart response: its headers and raw body. */
async function part(response: Response) {
  const mark = /boundary=(.+)$/.exec(response.headers.get('content-type') ?? '')![1];
  const text = await response.text();
  const [head, body] = text.split(`--${mark}\r\n`)[1].split('\r\n\r\n');
  return { head, content: body.slice(0, body.indexOf(`\r\n--${mark}`)) };
}

describe('ota manifest', () => {
  it('serves the stored manifest byte for byte, with the protocol headers', async () => {
    const response = await ask();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^multipart\/mixed; boundary=/);
    expect(response.headers.get('expo-protocol-version')).toBe('1');
    expect(response.headers.get('expo-sfv-version')).toBe('0');
    expect(response.headers.get('cache-control')).toBe('private, max-age=0');
    expect(response.headers.get('expo-manifest-filters')).toBe('expo-channel-name="production"');
    expect(response.headers.has('expo-server-defined-headers')).toBe(true);

    const { head, content } = await part(response);
    expect(head).toContain('name="manifest"');
    expect(head).toContain('content-type: application/json');
    expect(head).not.toContain('expo-signature');
    expect(content).toBe(MANIFEST);
  });

  it('passes the stored signature through when the client expects one', async () => {
    const { head, content } = await part(await ask({ 'expo-expect-signature': 'sig' }));
    const match = /expo-signature: sig="([^"]+)", keyid="main", alg="rsa-v1_5-sha256"/.exec(head);
    expect(match![1]).toBe(sign(MANIFEST));
    expect(createVerify('RSA-SHA256').update(content).verify(publicKey, match![1], 'base64')).toBe(
      true,
    );
  });

  it('fails loudly when a signature is expected but none was published', async () => {
    const unsigned: OtaDeps = {
      getText: (key) => Promise.resolve(key.endsWith('.sig') ? null : (bucket[key] ?? null)),
    };
    expect((await ask({ 'expo-expect-signature': 'sig' }, unsigned)).status).toBe(500);
  });

  it('holds no signing key and builds no manifest', () => {
    for (const file of ['handler.ts', 'index.ts']) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
      expect(source).not.toMatch(/PRIVATE_KEY|crypto\.subtle|createSign/);
    }
  });
});

describe('ota matching', () => {
  it('has nothing for another runtime version (directive on v1, 204 on v0)', async () => {
    const v1 = await ask({ 'expo-runtime-version': '9.9.9' });
    expect((await part(v1)).content).toBe(NO_UPDATE_DIRECTIVE);
    const v0 = await ask({ 'expo-runtime-version': '9.9.9', 'expo-protocol-version': '0' });
    expect(v0.status).toBe(204);
  });

  it('has nothing for a platform or channel with no pointer', async () => {
    expect((await part(await ask({ 'expo-platform': 'ios' }))).content).toBe(NO_UPDATE_DIRECTIVE);
    expect((await part(await ask({ 'expo-channel-name': 'preview' }))).content).toBe(
      NO_UPDATE_DIRECTIVE,
    );
  });

  it('says noUpdateAvailable when the device already runs the latest update', async () => {
    const response = await ask({ 'expo-current-update-id': UPDATE_ID.toUpperCase() });
    const { head, content } = await part(response);
    expect(head).toContain('name="directive"');
    expect(content).toBe(NO_UPDATE_DIRECTIVE);
  });

  it('passes the stored directive signature through, and 204s when there is none', async () => {
    const asked = { 'expo-expect-signature': 'sig', 'expo-current-update-id': UPDATE_ID };
    const { head } = await part(await ask(asked));
    expect(head).toContain(`expo-signature: sig="${sign(NO_UPDATE_DIRECTIVE)}"`);
    // No pointer and so no directive.sig under this channel: nothing signed to send.
    expect((await ask({ ...asked, 'expo-channel-name': 'preview' })).status).toBe(204);
  });

  it('rejects an unsupported platform, a path-like runtime and a bad channel', async () => {
    expect((await ask({ 'expo-platform': 'web' })).status).toBe(400);
    expect((await ask({ 'expo-runtime-version': '../x' })).status).toBe(400);
    expect((await ask({ 'expo-channel-name': 'a/b' })).status).toBe(400);
  });

  it('refuses anything but GET', async () => {
    const response = await handleOta(new Request('https://x.test/ota', { method: 'POST' }), deps);
    expect(response.status).toBe(405);
  });
});
