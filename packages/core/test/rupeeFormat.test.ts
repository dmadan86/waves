import { describe, expect, it } from 'vitest';

import { format, rupeeLocale } from '../src/money/format.js';
import { money } from '../src/money/money.js';

describe('rupee formatting', () => {
  it('groups rupees in lakhs whatever region the phone is in', () => {
    const amount = money(20925605n, 'INR');
    expect(format(amount, { locale: 'en-US' })).toBe('₹2,09,256.05');
    expect(format(amount, { locale: 'en-GB' })).toBe('₹2,09,256.05');
    expect(format(amount, { locale: 'en' })).toBe('₹2,09,256.05');
  });
  it('leaves other currencies and Arabic alone', () => {
    expect(format(money(20925605n, 'USD'), { locale: 'en-US' })).toBe('$209,256.05');
    expect(rupeeLocale('ar-AE', 'INR')).toBe('ar-AE');
    expect(rupeeLocale('hi', 'INR')).toBe('hi-IN');
  });
  it('rounds to whole units for a headline total', () => {
    expect(format(money(20925605n, 'INR'), { locale: 'en-US', whole: true })).toBe('₹2,09,256');
    expect(format(money(20925650n, 'INR'), { locale: 'en-IN', whole: true })).toBe('₹2,09,257');
  });
});
