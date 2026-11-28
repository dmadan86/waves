import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Hermes has no globalThis.crypto.randomUUID, so the phone's store must be handed an id
// source that works there (expo-crypto). Every couple save failed silently without it.
describe('couple space ids on a phone', () => {
  it('never relies on globalThis.crypto', () => {
    const src = (f: string) => readFileSync(join(__dirname, '../src/e2ee', f), 'utf8');
    expect(src('space.ts')).not.toMatch(/globalThis\.crypto/);
    expect(src('runtime.ts')).toMatch(/new E2eeSpace\([\s\S]*?Crypto\.randomUUID/s);
  });
});

// A launch with no network is normal: the first mailbox round must not raise the "e2ee.start" alert.
describe('e2ee start without a network', () => {
  it('swallows the first mailbox sync failure (retried by poll and sync cycle)', () => {
    const src = readFileSync(join(__dirname, '../src/e2ee/runtime.ts'), 'utf8');
    expect(src).toMatch(/await mailbox\.sync\(\)\.catch\(\(\) => undefined\);\n\}/);
  });
});
