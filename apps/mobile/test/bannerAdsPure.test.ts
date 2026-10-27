import { describe, expect, it } from 'vitest';
import { bannerGateOpen, bannerUnitId, shouldMountBanner } from '../src/lib/bannerAdsPure';

describe('banner ad unit ids', () => {
  it('uses platform test ids in development even when configured', () => {
    expect(bannerUnitId('ios', 'real', true)).toBe('ca-app-pub-3940256099942544/2934735716');
    expect(bannerUnitId('android', 'real', true)).toBe('ca-app-pub-3940256099942544/6300978111');
  });
  it('uses platform test ids when unconfigured or blank', () => {
    for (const configured of [undefined, '', '   ']) {
      expect(bannerUnitId('ios', configured, false)).toBe('ca-app-pub-3940256099942544/2934735716');
      expect(bannerUnitId('android', configured, false)).toBe(
        'ca-app-pub-3940256099942544/6300978111',
      );
    }
  });
  it('uses trimmed configured ids in production', () => {
    expect(bannerUnitId('ios', ' ios-real ', false)).toBe('ios-real');
    expect(bannerUnitId('android', ' android-real ', false)).toBe('android-real');
  });
});

describe('banner age gate', () => {
  it('requires an affirmative server decision', () => {
    expect(bannerGateOpen({ bannerEligible: true })).toBe(true);
    for (const status of [null, undefined, {}, { bannerEligible: false }])
      expect(bannerGateOpen(status)).toBe(false);
    expect(bannerGateOpen({ bannerEligible: 'true' as never })).toBe(false);
  });
});

describe('banner request eligibility', () => {
  it('requires an eligible cached gate and always blocks paid users', () => {
    const gate = { enabled: true, bannerEligible: true };
    expect(shouldMountBanner(gate, false)).toBe(true);
    expect(shouldMountBanner(gate, true)).toBe(false);
    for (const cached of [
      undefined,
      null,
      {},
      { ...gate, enabled: false },
      { ...gate, bannerEligible: false },
      { ...gate, nativeDailyCap: 0 },
    ]) {
      expect(shouldMountBanner(cached, false)).toBe(false);
    }
  });
});
