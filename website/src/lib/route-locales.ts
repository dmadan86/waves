import { defaultLocale, locales, type Locale } from '../i18n/config';

/**
 * Route families that exist in English only. The proxy, the sitemap and any
 * future translation links read this one list, so they cannot disagree. When a
 * family gets translations, drop it here and add the locales it now has.
 */
const englishOnlyPrefixes = ['/compare', '/alternatives', '/press', '/use-cases'] as const;

/** Exact path-boundary match: `/press` and `/press/x`, never `/pressroom`. */
export function isEnglishOnlyPath(path: string): boolean {
  return englishOnlyPrefixes.some((p) => path === p || path.startsWith(`${p}/`));
}

/** Locales a locale-less path (`/press`, `/privacy`) is published in. */
export function routeLocales(path: string): readonly Locale[] {
  return isEnglishOnlyPath(path) ? [defaultLocale] : locales;
}
