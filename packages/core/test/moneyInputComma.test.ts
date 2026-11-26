import { describe, expect, it } from 'vitest';
import { parseMinorInput, sanitiseMinorInput } from '../src/money/input.js';

describe('decimal comma input', () => {
  it('uses comma decimals through the currency precision', () => {
    expect(parseMinorInput('0,125', 'KWD')).toBe(125n);
    expect(parseMinorInput('1,234', 'INR')).toBe(123400n);
    expect(parseMinorInput('1,234', 'EUR')).toBe(123400n);
    expect(parseMinorInput('1,23', 'EUR')).toBe(123n);
  });

  it('preserves an unfinished comma decimal', () => {
    expect(sanitiseMinorInput('12,', 'INR')).toBe('12.');
    expect(sanitiseMinorInput('12,', 'KWD')).toBe('12.');
    expect(parseMinorInput('12,5', 'INR')).toBe(1250n);
  });
});

describe('pasted amounts read the same in every precision', () => {
  // [text, [JPY, KRW, INR, USD, KWD, BHD] minor units]
  const cases: [string, bigint[]][] = [
    ['1500.5', [1500n, 1500n, 150050n, 150050n, 1500500n, 1500500n]],
    ['1,500.00', [1500n, 1500n, 150000n, 150000n, 1500000n, 1500000n]],
    ['1.500,00', [1500n, 1500n, 150000n, 150000n, 1500000n, 1500000n]],
    ['12,50', [12n, 12n, 1250n, 1250n, 12500n, 12500n]],
  ];
  const currencies = ['JPY', 'KRW', 'INR', 'USD', 'KWD', 'BHD'] as const;
  for (const [text, expected] of cases) {
    it(`"${text}"`, () => {
      currencies.forEach((currency, i) => {
        expect(parseMinorInput(text, currency), `${text} ${currency}`).toBe(expected[i]);
      });
    });
  }

  it('keeps thousands separators in a currency with no decimals', () => {
    expect(parseMinorInput('1,500', 'JPY')).toBe(1500n);
    expect(parseMinorInput('1.500', 'JPY')).toBe(1500n);
    expect(parseMinorInput('1,500,000', 'JPY')).toBe(1500000n);
    expect(parseMinorInput('1500.', 'JPY')).toBe(1500n);
  });
});
