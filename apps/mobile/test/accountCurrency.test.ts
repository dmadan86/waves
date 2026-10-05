import { describe, expect, it } from 'vitest';

import { currencyAfterCountryChange, currencyOrigin } from '../src/lib/accountCurrency';

describe('currencyOrigin', () => {
  it('is country when it matches the country default', () => {
    expect(currencyOrigin('INR', 'INR')).toBe('country');
    expect(currencyOrigin('inr', 'INR')).toBe('country');
  });
  it('is chosen when it differs', () => {
    expect(currencyOrigin('USD', 'INR')).toBe('chosen');
  });
  it('is country when either side is unknown', () => {
    expect(currencyOrigin(null, 'INR')).toBe('country');
    expect(currencyOrigin('USD', null)).toBe('country');
  });
});

describe('currencyAfterCountryChange', () => {
  it('follows the new country when not overridden', () => {
    expect(currencyAfterCountryChange('INR', 'INR', 'GBP')).toBe('GBP');
  });
  it('keeps an override', () => {
    expect(currencyAfterCountryChange('USD', 'INR', 'GBP')).toBe('USD');
  });
  it('falls back to stored then default when the new country has none', () => {
    expect(currencyAfterCountryChange('INR', 'INR', null)).toBe('INR');
    expect(currencyAfterCountryChange(null, null, null)).toBe('INR');
  });
});
