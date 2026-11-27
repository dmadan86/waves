import { expect, it } from 'vitest';
import { fill, STRINGS_BY_LANGUAGE } from '../src/i18n';

it.each(['en', 'hi', 'ta', 'ar'] as const)('%s says what is left of a part payment', (language) => {
  const { settleLeft, settleAmountOver } = STRINGS_BY_LANGUAGE[language].misc;
  expect(fill(settleLeft, { amount: '₹3,000' })).toContain('₹3,000');
  expect(fill(settleAmountOver, { amount: '₹5,000' })).toContain('₹5,000');
});
it('en reads "₹3,000 left"', () => {
  expect(fill(STRINGS_BY_LANGUAGE.en.misc.settleLeft, { amount: '₹3,000' })).toBe('₹3,000 left');
});
