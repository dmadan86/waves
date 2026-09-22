/**
 * The second number on a foreign expense's row.
 *
 * The property under all of these is that the row may only ever show a figure
 * the ledger itself is using. A converted amount drawn from anything other
 * than the rate stored on that expense would be a number the balance disagrees
 * with, on the same screen, about the same bill.
 */
import { describe, expect, it } from 'vitest';

import { convertedTotal } from '../src/lib/expenseConversion';

/** 1 USD = 89.0 INR, as the ledger stores a rate: an exact rational. */
const USD_INR = {
  num: '890',
  den: '10',
  from: 'USD',
  to: 'INR',
  ts: '2026-09-22T00:00:00Z',
  source: 'manual',
};

const version = (over: Record<string, unknown> = {}) =>
  ({ currency: 'USD', amount: '2000', fx: USD_INR, ...over }) as never;

describe('what a foreign expense comes to', () => {
  it('converts with the rate the expense carries', () => {
    // $20.00 at 89 = ₹1,780.00
    expect(convertedTotal(version(), 'INR')).toEqual({ minor: 178000n, currency: 'INR' });
  });

  it('says nothing when the expense is already in the group currency', () => {
    // Not "converted at 1:1" — there is no second number to draw at all.
    expect(convertedTotal(version({ currency: 'INR', fx: null }), 'INR')).toBeNull();
  });

  it('says nothing when the expense carries no rate', () => {
    // The balance counts this in USD, so an INR figure here would contradict
    // the very screen it is drawn on.
    expect(convertedTotal(version({ fx: null }), 'INR')).toBeNull();
  });

  it('says nothing on a row mirrored before the rate was ever pulled', () => {
    // `fx` absent is a third state from `fx` null, and reads the same way.
    expect(convertedTotal(version({ fx: undefined }), 'INR')).toBeNull();
  });

  it('refuses a rate stored for a different pair', () => {
    // A THB rate does not convert a dollar bill. Storable, because a rate
    // outlives an edit to the currency it was stored against.
    expect(convertedTotal(version({ fx: { ...USD_INR, from: 'THB' } }), 'INR')).toBeNull();
    expect(convertedTotal(version({ fx: { ...USD_INR, to: 'AED' } }), 'INR')).toBeNull();
  });

  it('is null rather than a throw on a malformed rate', () => {
    expect(convertedTotal(version({ fx: { ...USD_INR, den: '0' } }), 'INR')).toBeNull();
  });
});
