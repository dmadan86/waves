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
