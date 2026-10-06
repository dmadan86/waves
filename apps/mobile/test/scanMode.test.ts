import { describe, expect, it } from 'vitest';

import { scanOpensPaste } from '../src/lib/scanMode';

describe('scanOpensPaste', () => {
  it('opens the paste step only for mode=paste', () => {
    expect(scanOpensPaste('paste')).toBe(true);
    expect(scanOpensPaste(['paste', 'x'])).toBe(true);
    expect(scanOpensPaste(undefined)).toBe(false);
    expect(scanOpensPaste('')).toBe(false);
    expect(scanOpensPaste('camera')).toBe(false);
    expect(scanOpensPaste([])).toBe(false);
  });
});
