import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Hermes has no globalThis.crypto.randomUUID, so the phone's store must be handed an id
// source that works there (expo-crypto). Every couple save failed silently without it.
describe('couple space ids on a phone', () => {
  it('never relies on globalThis.crypto', () => {
    const src = (f: string) => readFileSync(join(__dirname, '../src/e2ee', f), 'utf8');
    expect(src('space.ts')).not.toMatch(/globalThis\.crypto/);
    expect(src('runtime.ts')).toMatch(
      /new E2eeSpace\(syncEngine\.localStore,\s*\{[^}]*randomUUID/s,
    );
  });
});
