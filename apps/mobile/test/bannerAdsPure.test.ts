import { describe, expect, it } from 'vitest';
import { bannerUnitId } from '../src/lib/bannerAdsPure';

describe('banner ad unit ids', () => {
  it('uses platform test ids in development even when configured', () => {
    expect(bannerUnitId('ios', 'real', true)).toBe('ca-app-pub-3940256099942544/2934735716');
    expect(bannerUnitId('android', 'real', true)).toBe('ca-app-pub-3940256099942544/6300978111');
  });
  it('uses platform test ids when unconfigured or blank', () => {
    for (const configured of [undefined, '', '   ']) {
      expect(bannerUnitId('ios', configured, false)).toBe('ca-app-pub-3940256099942544/2934735716');
      expect(bannerUnitId('android', configured, false)).toBe('ca-app-pub-3940256099942544/6300978111');
    }
  });
  it('uses trimmed configured ids in production', () => {
    expect(bannerUnitId('ios', ' ios-real ', false)).toBe('ios-real');
    expect(bannerUnitId('android', ' android-real ', false)).toBe('android-real');
  });
});
