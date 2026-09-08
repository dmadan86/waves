/**
 * Every active ISO-4217 currency, with the region it belongs to.
 *
 * This is a real capability list, not a marketing number. The app stores money
 * as integer minor units plus a code and accepts any well-formed ISO-4217 code
 * (`packages/core/src/money/currency.ts`), so the honest claim is "all of
 * them" — and the page proves it by showing them.
 *
 * Only the codes and their regions live here. The *names* are produced per
 * locale at build time by `Intl.DisplayNames`, which means a Tamil reader gets
 * Tamil currency names and no one has to translate a hundred and eighty rows.
 */

export const REGIONS = ['africa', 'americas', 'asia', 'europe', 'oceania'] as const;

export type Region = (typeof REGIONS)[number];

export const CURRENCIES: Readonly<Record<Region, readonly string[]>> = Object.freeze({
  africa: [
    'AOA',
    'BIF',
    'BWP',
    'CDF',
    'CVE',
    'DJF',
    'DZD',
    'EGP',
    'ERN',
    'ETB',
    'GHS',
    'GMD',
    'GNF',
    'KES',
    'KMF',
    'LRD',
    'LSL',
    'LYD',
    'MAD',
    'MGA',
    'MRU',
    'MUR',
    'MWK',
    'MZN',
    'NAD',
    'NGN',
    'RWF',
    'SCR',
    'SDG',
    'SHP',
    'SLE',
    'SOS',
    'SSP',
    'STN',
    'SZL',
    'TND',
    'TZS',
    'UGX',
    'XAF',
    'XOF',
    'ZAR',
    'ZMW',
    'ZWG',
  ],
  americas: [
    'ARS',
    'AWG',
    'BBD',
    'BMD',
    'BOB',
    'BRL',
    'BSD',
    'BZD',
    'CAD',
    'CLP',
    'COP',
    'CRC',
    'CUP',
    'DOP',
    'GTQ',
    'GYD',
    'HNL',
    'HTG',
    'JMD',
    'KYD',
    'MXN',
    'NIO',
    'PAB',
    'PEN',
    'PYG',
    'SRD',
    'TTD',
    'USD',
    'UYU',
    'VES',
    'XCD',
  ],
  asia: [
    'AED',
    'AFN',
    'AMD',
    'AZN',
    'BDT',
    'BHD',
    'BND',
    'BTN',
    'CNY',
    'GEL',
    'HKD',
    'IDR',
    'ILS',
    'INR',
    'IQD',
    'IRR',
    'JOD',
    'JPY',
    'KGS',
    'KHR',
    'KPW',
    'KRW',
    'KWD',
    'KZT',
    'LAK',
    'LBP',
    'LKR',
    'MMK',
    'MNT',
    'MOP',
    'MVR',
    'MYR',
    'NPR',
    'OMR',
    'PHP',
    'PKR',
    'QAR',
    'SAR',
    'SGD',
    'SYP',
    'THB',
    'TJS',
    'TMT',
    'TRY',
    'TWD',
    'UZS',
    'VND',
    'YER',
  ],
  europe: [
    'ALL',
    'BAM',
    'BGN',
    'BYN',
    'CHF',
    'CZK',
    'DKK',
    'EUR',
    'GBP',
    'GIP',
    'HUF',
    'ISK',
    'MDL',
    'MKD',
    'NOK',
    'PLN',
    'RON',
    'RSD',
    'RUB',
    'SEK',
    'UAH',
  ],
  oceania: ['AUD', 'FJD', 'NZD', 'PGK', 'SBD', 'TOP', 'VUV', 'WST', 'XPF'],
});

export const CURRENCY_COUNT = REGIONS.reduce(
  (total, region) => total + CURRENCIES[region].length,
  0,
);

export type CurrencyRow = { code: string; name: string; symbol: string; region: Region };

/**
 * Names and symbols in the page's own language. `Intl.DisplayNames` runs at
 * build time on the server, so none of this reaches the browser as code — the
 * client only ever receives the finished rows.
 */
export function currencyRows(locale: string): CurrencyRow[] {
  const names = new Intl.DisplayNames([locale, 'en'], { type: 'currency' });

  return REGIONS.flatMap((region) =>
    CURRENCIES[region].map((code) => {
      // `formatToParts` is the only reliable way to get the symbol a locale
      // actually uses; some are the code itself, which is correct.
      const symbol =
        new Intl.NumberFormat(locale, { style: 'currency', currency: code })
          .formatToParts(0)
          .find((part) => part.type === 'currency')?.value ?? code;

      return { code, name: names.of(code) ?? code, symbol, region };
    }),
  ).sort((a, b) => a.code.localeCompare(b.code));
}
