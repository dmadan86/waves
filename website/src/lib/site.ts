import type { Metadata } from 'next';

import { htmlLang, locales, type Locale } from '@/i18n/config';

/**
 * Everything about "where this site lives" in one place. The marketing site is
 * the apex domain; the product itself is a separate deployment, so the CTAs
 * point outward rather than into a route that does not exist here.
 */
export const site = {
  name: 'Waves',
  domain: 'wavs.co.in',
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'https://wavs.co.in',
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.wavs.co.in',
  supportEmail: 'hello@wavs.co.in',

  /*
   * Store listings, when they exist. Left empty on purpose: a badge that links
   * nowhere is worse than no badge, and both vendors require their own
   * artwork, so `StoreBadges` renders a plain sentence until these are set.
   */
  iosUrl: process.env.NEXT_PUBLIC_IOS_URL ?? '',
  androidUrl: process.env.NEXT_PUBLIC_ANDROID_URL ?? '',
} as const;

/** Absolute URL for a locale-prefixed path, used by metadata and the sitemap. */
export function absoluteUrl(path = ''): string {
  const trimmed = path.startsWith('/') ? path : `/${path}`;
  return `${site.url}${trimmed === '/' ? '' : trimmed}`;
}

/**
 * The home page's canonical URL and the hreflang map that goes with it.
 *
 * Next merges metadata shallowly: a page that declares `alternates` at all
 * replaces the layout's block entirely. The home page has to declare one,
 * because it is the only route with a Markdown twin to point at, so the rest
 * of the block lives here rather than being written out twice.
 */
export function localeAlternates(locale: Locale): NonNullable<Metadata['alternates']> {
  return {
    canonical: absoluteUrl(`/${locale}`),
    languages: {
      ...Object.fromEntries(locales.map((l) => [htmlLang[l], absoluteUrl(`/${l}`)])),
      'x-default': absoluteUrl('/en'),
    },
  };
}
