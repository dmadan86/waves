import { describe, expect, it } from 'vitest';
import { createOfferGuard } from '../src/lib/rewardedAdOfferGuard';

describe('rewarded offer focus guard', () => {
  it('rejects an offer resolved after blur, including after refocus', async () => {
    const guard = createOfferGuard();
    guard.setFocused(true);
    const request = guard.begin();
    let resolve!: () => void;
    const pending = new Promise<void>((done) => {
      resolve = done;
    });
    const offer = pending.then(() => guard.isCurrent(request));
    guard.setFocused(false);
    expect(guard.isCurrent(request)).toBe(false);
    guard.setFocused(true);
    resolve();
    expect(await offer).toBe(false);
    expect(guard.isCurrent(guard.begin())).toBe(true);
  });

  it('supersedes earlier pending offers', () => {
    const guard = createOfferGuard();
    guard.setFocused(true);
    const first = guard.begin();
    const second = guard.begin();
    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });
});
