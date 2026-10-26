import { expect, it } from 'vitest';
import { homeCreditsLabel } from '@/lib/homeCreditsLabel';

it('shows the localized balance including zero, or a title until the wallet is known', () => {
  const strings = { creditsTitle: 'Credits', creditsLabel: '{n} credits' };
  expect(homeCreditsLabel(undefined, strings)).toBe('Credits');
  expect(homeCreditsLabel(null, strings)).toBe('Credits');
  expect(homeCreditsLabel(0, strings)).toBe('0 credits');
  expect(homeCreditsLabel(12, strings)).toBe('12 credits');
  expect(homeCreditsLabel(12, { ...strings, creditsLabel: '{n} கிரெடிட்கள்' })).toBe('12 கிரெடிட்கள்');
});
