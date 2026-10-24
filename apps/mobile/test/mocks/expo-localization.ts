/**
 * Minimal stub for expo-localization used in the vitest (Node) environment.
 *
 * The real package calls into the Expo native module, which is unavailable
 * in Node. The pure-logic tests only need the module to load cleanly and
 * `getLocales()` to return a sensible default so that `STRINGS_BY_LANGUAGE`
 * can be collected.
 */

export interface Locale {
  languageCode: string;
  languageTag: string;
  regionCode: string | null;
  languageRegionCode: string | null;
  currencyCode: string | null;
  currencySymbol: string | null;
  decimalSeparator: string | null;
  digitGroupingSeparator: string | null;
  measurementSystem: string | null;
  textDirection: string | null;
}

export function getLocales(): Locale[] {
  return [
    {
      languageCode: 'en',
      languageTag: 'en-IN',
      regionCode: 'IN',
      languageRegionCode: 'IN',
      currencyCode: 'INR',
      currencySymbol: '₹',
      decimalSeparator: '.',
      digitGroupingSeparator: ',',
      measurementSystem: 'metric',
      textDirection: 'ltr',
    },
  ];
}

export function getCalendars() {
  return [{ calendar: 'gregorian', timeZone: 'Asia/Kolkata' }];
}
