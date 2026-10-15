import { describe, expect, it } from 'vitest';

import { ANDROID_PACKAGE, playStoreUrl } from '../src/lib/storeLinks';

describe('playStoreUrl', () => {
  it('carries the referral code in the Play referrer, encoded once', () => {
    const url = playStoreUrl('ABCD2345');
    expect(url).toBe(
      'https://play.google.com/store/apps/details?id=app.waves.mobile&referrer=waves_ref%3DABCD2345',
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get('id')).toBe(ANDROID_PACKAGE);
    expect(parsed.searchParams.get('referrer')).toBe('waves_ref=ABCD2345');
  });

  it('is the plain store page without a code', () => {
    expect(playStoreUrl()).toBe('https://play.google.com/store/apps/details?id=app.waves.mobile');
    expect(playStoreUrl(null)).toBe(playStoreUrl());
  });
});
