/**
 * The guarded gate to the native Google Maps surface.
 *
 * Under vitest the surface cannot be required (its `@/` path is an alias Node's
 * `require` does not know, and `react-native-maps` is native code), which is
 * exactly the shape of an older binary without the module: the gate must answer
 * `null`, not throw while the file loads.
 */

import { describe, expect, it } from 'vitest';

describe('the native maps gate', () => {
  it('degrades to null, without throwing at import, where the surface cannot load', async () => {
    const { nativeMaps } = await import('../src/lib/nativeMaps');
    expect(nativeMaps).toBeNull();
  });
});
