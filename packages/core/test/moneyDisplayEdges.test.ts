import { describe, expect, it } from 'vitest';

import { compactMoney, format, money, type CurrencyCode } from '../src/index';

const nb = (s: string) => s.replace(/\u00a0/g, ' ');
const f = (minor: bigint, c: string, locale: string, trimZeros = true) =>
  nb(format(money(minor, c as CurrencyCode), { locale: locale as never, trimZeros }));
const c = (minor: bigint, cur: string, locale = 'en-IN') =>
  nb(compactMoney(money(minor, cur as CurrencyCode), { locale: locale as never }));

describe('trimZeros across minor-unit exponents', () => {
  it('JPY (0 decimals) is unchanged by trimming', () => {
    expect(f(500n, 'JPY', 'ja-JP')).toBe(f(500n, 'JPY', 'ja-JP', false));
    expect(f(500n, 'JPY', 'ja-JP')).toMatch(/500$/);
  });

  it('KWD and BHD (3 decimals) drop only a fully zero fraction', () => {
    expect(f(1234000n, 'KWD', 'en-US')).toBe('KWD 1,234');
    expect(f(1234500n, 'KWD', 'en-US')).toBe('KWD 1,234.500');
    expect(f(1234001n, 'KWD', 'en-US')).toBe('KWD 1,234.001');
    expect(f(1500n, 'BHD', 'en-US')).toBe('BHD 1.500');
    expect(f(1000n, 'BHD', 'en-US')).toBe('BHD 1');
  });

  it('a 2-decimal amount whose last digit is the only nonzero one keeps its paise', () => {
    expect(f(5n, 'INR', 'en-IN')).toBe('₹0.05');
    expect(f(10n, 'INR', 'en-IN')).toBe('₹0.10');
  });

  it('negative amounts trim the same way and keep the sign', () => {
    expect(f(-75000n, 'INR', 'en-IN')).toBe('-₹750');
    expect(f(-75050n, 'INR', 'en-IN')).toBe('-₹750.50');
    expect(f(-1234000n, 'KWD', 'en-US')).toBe('-KWD 1,234');
  });

  it('keeps lakh and crore grouping when trimmed', () => {
    expect(f(1500000000n, 'INR', 'en-IN')).toBe('₹1,50,00,000');
    expect(f(10000000n, 'INR', 'en-IN')).toBe('₹1,00,000');
    expect(f(10000050n, 'INR', 'en-IN')).toBe('₹1,00,000.50');
  });

  it('RTL (ar): real paise survive and a bare .00 goes', () => {
    expect(f(7500000n, 'INR', 'ar')).not.toMatch(/\.00/);
    expect(f(7500050n, 'INR', 'ar')).toMatch(/75,000\.50/);
    expect(f(7500000n, 'INR', 'ar')).toMatch(/75,000/);
  });

  it('whole beats trimZeros and untrimmed output stays exact', () => {
    expect(format(money(20925650n, 'INR'), { locale: 'en-IN', whole: true, trimZeros: true })).toBe(
      '₹2,09,257',
    );
    expect(f(75000n, 'INR', 'en-IN', false)).toBe('₹750.00');
  });

  it('huge values do not lose precision (bigint path)', () => {
    expect(f(99999999999999900n, 'INR', 'en-IN')).toBe('₹99,99,99,99,99,99,999');
  });
});

describe('compactMoney', () => {
  it('stays plain under a thousand major units, paise included', () => {
    expect(c(99999n, 'INR')).toBe('₹999.99');
    expect(c(0n, 'INR')).toBe('₹0.00');
  });

  it('reads rupees in K, L and Cr, in negative too', () => {
    expect(c(100000n, 'INR')).toBe('₹1K');
    expect(c(10000000n, 'INR')).toBe('₹1L');
    expect(c(100000000n, 'INR')).toBe('₹10L');
    expect(c(-123456789n, 'INR')).toBe('-₹12.3L');
    expect(c(1500000000n, 'INR')).toBe('₹1.5Cr');
  });

  it('rupees read in lakhs even under a western locale', () => {
    expect(c(100000000n, 'INR', 'en-US')).toBe('₹10L');
  });

  it('other currencies use K and M', () => {
    expect(c(320000n, 'USD', 'en-US')).toBe('$3.2K');
    expect(c(-320000n, 'USD', 'en-US')).toBe('-$3.2K');
    expect(c(150000000n, 'USD', 'en-US')).toBe('$1.5M');
    expect(c(100000000n, 'AED', 'en-AE')).toBe('AED 1M');
  });

  it('3-decimal currencies compact by major units, not minor', () => {
    expect(c(1234500n, 'KWD', 'en-US')).toBe('KWD 1.2K');
    expect(c(999999n, 'KWD', 'en-US')).toBe('KWD 999.999');
  });

  it('JPY (no minor unit) compacts from 1000 yen', () => {
    expect(c(999n, 'JPY', 'ja-JP')).toMatch(/999$/);
    expect(c(100000000n, 'JPY', 'ja-JP')).toMatch(/億|M/);
  });

  it('signDisplay never drops the minus; always adds a plus', () => {
    const m = money(-320000n, 'USD');
    expect(compactMoney(m, { locale: 'en-US', signDisplay: 'never' })).toBe('$3.2K');
    expect(compactMoney(money(320000n, 'USD'), { locale: 'en-US', signDisplay: 'always' })).toBe(
      '+$3.2K',
    );
  });

  it('RTL (ar) still yields a compact figure with the currency', () => {
    const t = c(7500000n, 'INR', 'ar');
    expect(t).toMatch(/75/);
    expect(t).toMatch(/₹/);
  });
});
