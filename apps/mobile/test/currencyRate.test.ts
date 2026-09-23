/**
 * The pure pieces behind the foreign-currency rate card.
 *
 * `currencyMark` and `currencyName` label the currency chips; `parseMinor` is
 * how the card reads "what your bank charged" before implying a rate from it.
 * It must read digits, never a float — `4562.50` is 456250 paise exactly — and
 * refuse anything that is not plainly an amount, so the card can say so rather
 * than store a rate implied by garbage. The rest of the card (the effect that
 * recomputes the rate when the expense amount changes) is React state and is
 * left to the device flows.
 */

import { describe, expect, it, vi } from 'vitest';

import { money, rateFromAmounts, rateToDecimal } from '@waves/core';

import { currencyMark, currencyName } from '../src/lib/tripRates';

// The component module pulls React Native, the UI kit and the network in at
// import time; none of that is under test here.
vi.mock('react-native', () => ({ TextInput: () => null, View: () => null }));
vi.mock('@waves/ui', () => ({
  Button: () => null,
  Callout: () => null,
  Card: () => null,
  ChipRow: () => null,
  Row: () => null,
  Text: () => null,
  useTheme: () => ({}),
}));
vi.mock('@/i18n', () => ({ useStrings: () => ({ t: {} }) }));
vi.mock('@/lib/errors', () => ({ friendlyError: (error: unknown) => String(error) }));
vi.mock('@/data/api', () => ({ fetchFxRate: vi.fn() }));

const { parseMinor } = await import('../src/components/CurrencyRate');

describe('currencyMark', () => {
  it('gives a currency’s own symbol', () => {
    expect(currencyMark('INR')).toBe('₹');
    expect(currencyMark('USD')).toBe('$');
    expect(currencyMark('EUR')).toBe('€');
  });

  it('is empty when the only "symbol" is the code itself, so a chip never reads "AED AED"', () => {
    expect(currencyMark('AED')).toBe('');
    expect(currencyMark('SGD')).toBe('');
    expect(currencyMark('ZZZ')).toBe('');
  });
});

describe('currencyName', () => {
  it('names a currency in the reader’s language', () => {
    // Case-insensitive: ICU releases have differed on "Dong" vs "dong".
    expect(currencyName('VND', 'en')).toMatch(/^vietnamese dong$/i);
    expect(currencyName('INR', 'en')).toMatch(/^indian rupee$/i);
  });

  it('is null — not the code again — where the platform has no name for it', () => {
    expect(currencyName('ZZZ', 'en')).toBeNull();
  });

  it('is null rather than a crash for a code or locale the platform rejects', () => {
    expect(currencyName('not-a-code', 'en')).toBeNull();
    expect(currencyName('INR', '!!')).toBeNull();
  });

  it('is null when the runtime has no Intl.DisplayNames at all', () => {
    const original = Intl.DisplayNames;
    try {
      (Intl as { DisplayNames?: unknown }).DisplayNames = undefined;
      expect(currencyName('INR', 'en')).toBeNull();
    } finally {
      (Intl as { DisplayNames?: unknown }).DisplayNames = original;
    }
  });
});

describe('parseMinor (the charged amount)', () => {
  it('reads decimal text as exact minor units', () => {
    expect(parseMinor('4562.50', 'INR')).toBe(456_250n);
    expect(parseMinor('4562.5', 'INR')).toBe(456_250n);
    expect(parseMinor('4562', 'INR')).toBe(456_200n);
    expect(parseMinor('  0.07 ', 'INR')).toBe(7n);
  });

  it('ignores thousands separators', () => {
    expect(parseMinor('1,23,456.78', 'INR')).toBe(12_345_678n);
  });

  it('uses the currency’s own exponent', () => {
    expect(parseMinor('1500', 'JPY')).toBe(1_500n);
    expect(parseMinor('1.234', 'KWD')).toBe(1_234n);
  });

  // Open question, reported rather than pinned: today a charged amount with
  // more decimals than the currency has is silently truncated — "10.999" INR
  // reads as ₹10.99, "1500.9" JPY as ¥1500 — and the card stores a rate implied
  // by a figure the person never typed. Refusing it ("not an amount") like any
  // other malformed input looks like the intended behaviour.
  it.todo('refuses a charged amount with more decimals than the currency has');

  it('refuses anything that is not plainly an amount', () => {
    for (const text of ['', '   ', 'abc', '-5', '1e3', '.5', '5.', '12.3.4', '₹100']) {
      expect(() => parseMinor(text, 'INR'), text).toThrow('not an amount');
    }
  });

  it('implies the rate the card stores from what the bank charged', () => {
    // $50.00 charged as ₹4,150.00 → 83 rupees to the dollar.
    const rate = rateFromAmounts(
      money(5_000n, 'USD' as never),
      money(parseMinor('4,150.00', 'INR'), 'INR' as never),
    );
    expect(Number(rateToDecimal(rate))).toBe(83);
  });
});
