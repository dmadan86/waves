/**
 * The hand-off amount, and the ways a route parameter is not a number.
 *
 * Every one of these reached a screen that was about to seed its state with it,
 * where the alternative to a zero is a thrown `SyntaxError` behind a white
 * screen.
 */
import { describe, expect, it } from 'vitest';

import { routeAmount } from '../src/lib/routeAmount';

describe('an amount handed over in a route', () => {
  it('reads an ordinary figure', () => {
    expect(routeAmount('130000')).toBe(130000n);
  });

  it('is nothing when nothing was handed over', () => {
    expect(routeAmount(undefined)).toBe(0n);
    expect(routeAmount('')).toBe(0n);
  });

  it('is nothing rather than a throw when the parameter is not a number', () => {
    // `BigInt` throws on all of these, and a screen seeding its state from a
    // link cannot afford a throw.
    expect(routeAmount('twelve')).toBe(0n);
    expect(routeAmount('12.50')).toBe(0n);
    expect(routeAmount('1e5')).toBe(0n);
  });

  it('keeps a figure too large for a Number exactly', () => {
    expect(routeAmount('9007199254740993')).toBe(9007199254740993n);
  });
});
