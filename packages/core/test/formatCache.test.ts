import { afterEach, describe, expect, it } from 'vitest';

import { currencySymbol, format, formatParts } from '../src/money/format.js';
import { money } from '../src/money/money.js';

/**
 * The formatter cache: the output must be byte-for-byte what a fresh
 * `Intl.NumberFormat` prints, and a repeated call must not build another one.
 */

const RealNumberFormat = Intl.NumberFormat;
let constructed = 0;

function countConstructions(): void {
  constructed = 0;
  // A Proxy keeps `Intl.NumberFormat` a real constructor (prototype,
  // `supportedLocalesOf`) and only counts the `new`s.
  Intl.NumberFormat = new Proxy(RealNumberFormat, {
    construct(target, args: ConstructorParameters<typeof Intl.NumberFormat>) {
      constructed += 1;
      return new target(...args);
    },
  });
}

afterEach(() => {
  Intl.NumberFormat = RealNumberFormat;
});

function uncached(minor: bigint, currency: string, locale: string, signDisplay: 'auto' | 'always') {
  const digits = currency === 'JPY' ? 0 : currency === 'KWD' ? 3 : 2;
  return new RealNumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay,
  }).format(Number(minor) / 10 ** digits);
}

describe('money formatter cache', () => {
  it('prints exactly what a freshly built formatter prints', () => {
    for (const locale of ['en-IN', 'ta-IN', 'hi-IN', 'en-US', 'de-DE', 'ar']) {
      for (const currency of ['INR', 'USD', 'EUR', 'JPY', 'KWD'] as const) {
        for (const minor of [0n, 1n, -1n, 151753n, -8010000n, 123456789n]) {
          for (const signDisplay of ['auto', 'always'] as const) {
            const amount = money(minor, currency as 'INR');
            // Twice, so the second call is served from the cache.
            format(amount, { locale, signDisplay });
            const text = format(amount, { locale, signDisplay });
            expect(text).toBe(uncached(minor, currency, locale, signDisplay));
            expect(formatParts(amount, { locale, signDisplay }).text).toBe(text);
          }
        }
      }
    }
  });

  it('builds one formatter per locale/currency/sign and reuses it', () => {
    countConstructions();
    const amount = money(151753n, 'CHF' as 'INR');

    for (let i = 0; i < 50; i += 1) format(amount, { locale: 'en-GB' });
    expect(constructed).toBe(1);

    for (let i = 0; i < 50; i += 1) formatParts(amount, { locale: 'en-GB' });
    expect(constructed).toBe(1);

    // A different sign display, locale or currency is a different formatter…
    format(amount, { locale: 'en-GB', signDisplay: 'always' });
    format(amount, { locale: 'fr-CH' });
    format(money(100n, 'SEK' as 'INR'), { locale: 'en-GB' });
    expect(constructed).toBe(4);

    // …and 'never' renders the magnitude through the 'auto' one it already has.
    format(money(-151753n, 'CHF' as 'INR'), { locale: 'en-GB', signDisplay: 'never' });
    expect(constructed).toBe(4);
  });

  it('caches the symbol lookup too', () => {
    countConstructions();
    const first = currencySymbol('NOK' as 'INR', 'en-GB');
    for (let i = 0; i < 20; i += 1) expect(currencySymbol('NOK' as 'INR', 'en-GB')).toBe(first);
    expect(constructed).toBe(1);
  });

  it('does not cache a formatter that failed to build', () => {
    countConstructions();
    expect(() => format(money(1n, 'NOPE' as 'INR'), { locale: 'en-GB' })).toThrow();
    expect(() => format(money(1n, 'NOPE' as 'INR'), { locale: 'en-GB' })).toThrow();
    // A malformed locale gets as far as the constructor, which throws; both
    // calls must try to build one, so the failure was not cached.
    constructed = 0;
    expect(() => format(money(1n, 'INR'), { locale: 'not a locale!' })).toThrow();
    expect(() => format(money(1n, 'INR'), { locale: 'not a locale!' })).toThrow();
    expect(constructed).toBe(2);
  });
});
