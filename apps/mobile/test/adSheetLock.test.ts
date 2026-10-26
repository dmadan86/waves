import { beforeEach, describe, expect, it } from 'vitest';

import { adSheetTaken, claimAdSheet, releaseAdSheet, resetAdSheetLock } from '@/lib/adSheetLock';

describe('adSheetLock', () => {
  beforeEach(resetAdSheetLock);

  it('prevents a second owner from claiming while the first holds it', () => {
    const first = Symbol('first');
    const second = Symbol('second');
    expect(adSheetTaken(first)).toBe(false);
    expect(claimAdSheet(first)).toBe(true);
    expect(adSheetTaken(first)).toBe(false);
    expect(adSheetTaken(second)).toBe(true);
    expect(claimAdSheet(second)).toBe(false);
  });

  it('ignores release by a non-owner', () => {
    const first = Symbol('first');
    const second = Symbol('second');
    claimAdSheet(first);
    releaseAdSheet(second);
    expect(claimAdSheet(second)).toBe(false);
    expect(adSheetTaken(second)).toBe(true);
  });

  it('allows another owner to claim after release', () => {
    const first = Symbol('first');
    const second = Symbol('second');
    claimAdSheet(first);
    releaseAdSheet(first);
    expect(adSheetTaken(second)).toBe(false);
    expect(claimAdSheet(second)).toBe(true);
  });

  it('allows the same owner to claim again', () => {
    const owner = Symbol('owner');
    expect(claimAdSheet(owner)).toBe(true);
    expect(claimAdSheet(owner)).toBe(true);
    releaseAdSheet(owner);
    expect(claimAdSheet(Symbol('next'))).toBe(true);
  });
});
