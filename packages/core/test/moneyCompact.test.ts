import { describe, expect, it } from 'vitest';

import { compactMoney, money, type CurrencyCode } from '../src/money';

const c = (minor: bigint, currency: string, locale?: string) =>
  compactMoney(money(minor, currency as CurrencyCode), { locale });

describe('compactMoney', () => {
  it('reads rupees in lakhs and crores, whatever the region', () => {
    expect(c(32_000_000n, 'INR', 'en-IN')).toBe('₹3.2L');
    expect(c(1_500_000_000n, 'INR', 'en-IN')).toBe('₹1.5Cr');
    expect(c(32_000_000n, 'INR', 'en-US')).toBe('₹3.2L');
  });
  it('reads dollars in K and M', () => {
    expect(c(320_000n, 'USD', 'en-US')).toBe('$3.2K');
    expect(c(150_000_000n, 'USD', 'en-US')).toBe('$1.5M');
  });
  it('handles dirhams and yen (no minor unit)', () => {
    expect(c(320_000n, 'AED', 'en-US')).toMatch(/^AED\s3\.2K$/);
    expect(c(3200n, 'JPY', 'en-US')).toBe('¥3.2K');
    expect(c(1_500_000n, 'JPY', 'en-US')).toBe('¥1.5M');
  });
  it('keeps the sign and leaves small amounts alone', () => {
    expect(c(-32_000_000n, 'INR', 'en-IN')).toBe('-₹3.2L');
    expect(c(95_050n, 'USD', 'en-US')).toBe('$950.50');
  });
});
