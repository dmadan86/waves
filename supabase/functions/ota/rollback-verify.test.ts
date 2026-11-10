/** Rollback trust check (apps/mobile/scripts/ota-verify.mjs): signature plus binding. */

import { createSign, generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

// @ts-expect-error plain .mjs script module
import { verifyPublishedMetadata } from '../../../apps/mobile/scripts/ota-verify.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const sign = (text: string) => createSign('RSA-SHA256').update(text).sign(privateKey, 'base64');

const FOLDER = '11111111-2222-4333-8444-555555555555';
const metadata = {
  fileMetadata: { android: { bundle: 'b.hbc', assets: [{ path: 'a1', ext: 'png' }] } },
  hashes: { 'b.hbc': 'h1', a1: 'h2' },
  otaBinding: {
    runtimeVersion: '1.3.1',
    channel: 'production',
    platforms: ['android'],
    folder: FOLDER,
  },
};
const want = { runtime: '1.3.1', channel: 'production', platform: 'android', folder: FOLDER };

function verify(text = JSON.stringify(metadata), overrides = {}, signature = sign(text)) {
  return verifyPublishedMetadata({ text, signature, publicKey, ...want, ...overrides });
}

describe('rollback verify', () => {
  it('accepts matching, signed metadata', () => {
    expect(verify().hashes['b.hbc']).toBe('h1');
  });

  it.each([
    ['runtime', { runtime: '2.0.0' }],
    ['channel', { channel: 'preview' }],
    ['platform', { platform: 'ios' }],
    ['folder', { folder: '99999999-2222-4333-8444-555555555555' }],
  ])('refuses a wrong %s', (_name, overrides) => {
    expect(() => verify(undefined, overrides)).toThrow();
  });

  it('refuses a tampered hash and a missing or foreign signature', () => {
    const tampered = JSON.stringify({ ...metadata, hashes: { 'b.hbc': 'evil', a1: 'h2' } });
    expect(() => verify(tampered, {}, sign(JSON.stringify(metadata)))).toThrow('bad signature');
    expect(() => verify(undefined, {}, '')).toThrow('bad signature');
  });

  it('refuses signed metadata with no binding (published before this check)', () => {
    const { otaBinding: _drop, ...bare } = metadata;
    expect(() => verify(JSON.stringify(bare))).toThrow();
  });
});
