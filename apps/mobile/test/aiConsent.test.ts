import { describe, expect, it } from 'vitest';

import { aiConsentKey, isAiConsentGranted } from '../src/lib/aiConsentPure';

describe('ai consent', () => {
  it('is per account', () => {
    expect(aiConsentKey('a')).not.toBe(aiConsentKey('b'));
  });
  it('counts only an explicit grant', () => {
    expect(isAiConsentGranted('granted')).toBe(true);
    expect(isAiConsentGranted(null)).toBe(false);
    expect(isAiConsentGranted('declined')).toBe(false);
  });
});
