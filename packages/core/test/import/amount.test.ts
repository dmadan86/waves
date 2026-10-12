import { describe, expect, it } from 'vitest';

import { detectDecimalStyle, parseLooseAmount } from '../../src/import/amount.js';

const minor = (text: string, currency = 'INR', style: 'dot' | 'comma' | 'auto' = 'auto') => {
  const result = parseLooseAmount(text, currency, style);
  return result.ok ? result.minor : result.reason;
};

describe('parseLooseAmount', () => {
  it.each([
    ['₹1,23,456.78', 12345678n],
    ['1,234.56', 123456n],
    ['1.234,56', 123456n],
    ['1 234,56', 123456n],
    ["1'234.56", 123456n],
    ['450', 45000n],
    ['450.5', 45050n],
    ['0.05', 5n],
    ['Rs. 450', 45000n],
    ['Rs 1,200', 120000n],
    ['INR 99.99', 9999n],
    ['99.99 INR', 9999n],
    ['+120', 12000n],
  ])('reads %s', (text, expected) => {
    expect(minor(text)).toBe(expected);
  });

  it.each([
    ['-5', -500n],
    ['−5', -500n],
    ['(120.00)', -12000n],
    ['120-', -12000n],
    ['120 CR', -12000n],
    ['120 DR', 12000n],
  ])('reads the sign in %s', (text, expected) => {
    expect(minor(text)).toBe(expected);
  });

  it('reads Devanagari, Tamil and Arabic-Indic digits and separators', () => {
    expect(minor('१२३४.५०')).toBe(123450n);
    expect(minor('௧௨௩௪')).toBe(123400n);
    expect(minor('٣٥٠٫٥٠')).toBe(35050n);
    expect(minor('١٬٢٣٤٫٥٦')).toBe(123456n);
  });

  it('treats a lone comma by the column’s style', () => {
    expect(minor('1,234')).toBe(123400n);
    expect(minor('12,5')).toBe(1250n);
    expect(minor('1,234', 'INR', 'comma')).toBe('too_many_decimals');
    expect(minor('1,234', 'INR', 'dot')).toBe(123400n);
    expect(minor('1.234', 'INR', 'comma')).toBe(123400n);
    expect(minor('1.234', 'INR', 'dot')).toBe('too_many_decimals');
  });

  it('uses the currency’s own minor unit', () => {
    expect(minor('1500', 'JPY')).toBe(1500n);
    expect(minor('1.250', 'KWD')).toBe(1250n);
    expect(minor('10.5', 'USD')).toBe(1050n);
  });

  it('refuses digits the currency cannot hold, but allows trailing zeros', () => {
    expect(minor('₹10.005')).toBe('too_many_decimals');
    expect(minor('100.5', 'JPY')).toBe('too_many_decimals');
    expect(minor('10.500')).toBe(1050n);
    expect(minor('100.00', 'JPY')).toBe(100n);
  });

  it('reports a currency named in the cell', () => {
    expect(parseLooseAmount('€12.50', 'EUR')).toMatchObject({ ok: true, currency: 'EUR' });
    expect(parseLooseAmount('Rs. 5', 'INR')).toMatchObject({ currency: 'INR' });
    expect(parseLooseAmount('GBP 9', 'INR')).toMatchObject({ currency: 'GBP' });
    expect(parseLooseAmount('$5', 'USD')).toMatchObject({ ok: true, currency: null });
  });

  it('calls empty cells empty and junk unreadable', () => {
    expect(minor('')).toBe('empty');
    expect(minor('₹')).toBe('empty');
    expect(minor('-')).toBe('empty');
    expect(minor('abc')).toBe('unreadable');
    expect(minor('--5')).toBe('unreadable');
    expect(minor('12 apples')).toBe('unreadable');
  });
});

describe('detectDecimalStyle', () => {
  it('is settled by a value that can only be read one way', () => {
    expect(detectDecimalStyle(['1.234,56', '10'])).toEqual({ style: 'comma', ambiguous: false });
    expect(detectDecimalStyle(['1,234.56', '10,5'])).toMatchObject({ style: 'dot' });
    expect(detectDecimalStyle(['12,5', '3,75'])).toEqual({ style: 'comma', ambiguous: false });
    expect(detectDecimalStyle(['12.50', '300'])).toEqual({ style: 'dot', ambiguous: false });
  });

  it('flags a column where every value could be thousands', () => {
    expect(detectDecimalStyle(['1,234', '2,500'])).toEqual({ style: 'dot', ambiguous: true });
  });
});
