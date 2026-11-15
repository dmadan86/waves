import { expect, it } from 'vitest';
import { homeCreditsAction, isHomeCreditsLow } from '@/lib/isHomeCreditsLow';

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

it('chooses the Home label and zero badge without highlighting funded wallets', () => {
  expect(homeCreditsAction(2, 1)).toEqual({
    labelKey: 'creditMany',
    badge: undefined,
    highlight: false,
  });
  expect(homeCreditsAction(1, 1)).toEqual({
    labelKey: 'creditOne',
    badge: undefined,
    highlight: false,
  });
  for (const [balance, cost] of [
    [0, 1],
    [-1, 1],
    [2, 3],
    [0, 0],
  ]) {
    expect(homeCreditsAction(balance, cost)).toEqual({
      labelKey: 'getCredits',
      badge: 0,
      highlight: true,
    });
  }
  expect(homeCreditsAction(undefined, 1)).toEqual({
    labelKey: 'creditsTitle',
    badge: undefined,
    highlight: false,
  });
  expect(homeCreditsAction(null, null)).toEqual({
    labelKey: 'creditsTitle',
    badge: undefined,
    highlight: false,
  });
  expect(homeCreditsAction(2, undefined)).toEqual({
    labelKey: 'creditMany',
    badge: undefined,
    highlight: false,
  });
});
