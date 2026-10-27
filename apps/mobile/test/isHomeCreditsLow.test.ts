import { expect, it } from 'vitest';
import { isHomeCreditsLow } from '@/lib/isHomeCreditsLow';

it('highlights balances strictly below the voice cost', () => {
  expect(isHomeCreditsLow(0, 1)).toBe(true);
  expect(isHomeCreditsLow(-1, 1)).toBe(true);
  expect(isHomeCreditsLow(1, 1)).toBe(false);
  expect(isHomeCreditsLow(12, 1)).toBe(false);
  expect(isHomeCreditsLow(2, 3)).toBe(true);
  expect(isHomeCreditsLow(3, 3)).toBe(false);
  expect(isHomeCreditsLow(0, 0)).toBe(false);
});

it('keeps loading and unavailable wallets neutral', () => {
  expect(isHomeCreditsLow(undefined, 1)).toBe(false);
  expect(isHomeCreditsLow(null, 1)).toBe(false);
  expect(isHomeCreditsLow(0, undefined)).toBe(false);
  expect(isHomeCreditsLow(0, null)).toBe(false);
});
