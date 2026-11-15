import { describe, expect, it } from 'vitest';
import { parsePercentBps, percentToMinor } from '../src/lib/discount';

describe('percent discount', () => {
  it('parses up to two decimals within 0-100', () => {
    expect(parsePercentBps('12.5')).toBe(1250n);
    expect(parsePercentBps('100')).toBe(10000n);
    expect(parsePercentBps('100.01')).toBeNull();
    expect(parsePercentBps('1.234')).toBeNull();
    expect(parsePercentBps('')).toBeNull();
  });
  it('rounds half up to minor units and clamps to the subtotal', () => {
    expect(percentToMinor(4500000n, '10')).toBe(450000n);
    expect(percentToMinor(1001n, '0.5')).toBe(5n); // 5.005 -> 5
    expect(percentToMinor(1010n, '0.5')).toBe(5n); // 5.05 -> 5
    expect(percentToMinor(1n, '50')).toBe(1n); // 0.5 -> 1 (half up)
    expect(percentToMinor(100n, 'abc')).toBe(0n);
    expect(percentToMinor(100n, '100')).toBe(100n);
  });
});
