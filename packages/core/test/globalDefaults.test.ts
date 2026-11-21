import { describe, expect, it } from 'vitest';

import {
  instantTransferName,
  normalizePaymentMethod,
  resolveCurrency,
  weekStartForRegion,
} from '../src';

describe('weekStartForRegion', () => {
  it('follows the region', () => {
    expect(weekStartForRegion('US')).toBe(0);
    expect(weekStartForRegion('IN')).toBe(0);
    expect(weekStartForRegion('GB')).toBe(1);
    expect(weekStartForRegion('AU')).toBe(1);
    expect(weekStartForRegion('AE')).toBe(1);
    expect(weekStartForRegion('QA')).toBe(6);
  });
  it('is Monday when the region is unknown', () => {
    expect(weekStartForRegion(null)).toBe(1);
    expect(weekStartForRegion('')).toBe(1);
  });
});

describe('payment method', () => {
  it('reads upi as instant_transfer and leaves the rest alone', () => {
    expect(normalizePaymentMethod('upi')).toBe('instant_transfer');
    expect(normalizePaymentMethod('instant_transfer')).toBe('instant_transfer');
    expect(normalizePaymentMethod('card')).toBe('card');
    expect(normalizePaymentMethod(null)).toBeNull();
  });
  it('names the local rail', () => {
    expect(instantTransferName('IN')).toBe('UPI');
    expect(instantTransferName('gb')).toBe('Faster Payments');
    expect(instantTransferName('AU')).toBe('PayID');
    expect(instantTransferName('US')).toBe('Zelle');
    expect(instantTransferName('AE')).toBe('Aani');
    expect(instantTransferName('DE')).toBeNull();
    expect(instantTransferName(undefined)).toBeNull();
  });
});

describe('resolveCurrency', () => {
  it('prefers the profile, then the country, then the fallback', () => {
    expect(resolveCurrency('gbp', 'IN')).toBe('GBP');
    expect(resolveCurrency(null, 'AE')).toBe('AED');
    expect(resolveCurrency(null, 'ZZ')).toBe('USD');
    expect(resolveCurrency(undefined, null, 'EUR')).toBe('EUR');
  });
});
