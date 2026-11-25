import { describe, expect, it } from 'vitest';

import { advanceLeft } from './advanceLeftPure';

describe('advanceLeft', () => {
  it('subtracts wage recovery and returned cash', () => {
    expect(advanceLeft(1000n, 300n, 200n)).toBe(500n);
  });
  it('never goes below zero', () => {
    expect(advanceLeft(500n, 400n, 300n)).toBe(0n);
  });
});
