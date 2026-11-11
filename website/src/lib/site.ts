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
  androidUrl:
    process.env.NEXT_PUBLIC_ANDROID_URL ??
    'https://play.google.com/store/apps/details?id=app.waves.mobile',

  /*
   * Official social profiles. Empty hides the footer link and drops the entry
   * from the Organization `sameAs`; set the env vars once the accounts exist.
   */
  instagramUrl: process.env.NEXT_PUBLIC_INSTAGRAM_URL ?? '',
  xUrl: process.env.NEXT_PUBLIC_X_URL ?? '',
} as const;

/** Profiles that are actually configured, for the footer and structured data. */
export const socialLinks = [
  { name: 'Instagram', href: site.instagramUrl },
  { name: 'X', href: site.xUrl },
].filter((l) => l.href);

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

/**
 * Metadata for a locale-prefixed page: self-canonical, hreflang for the locales
 * it exists in, and page-specific OG/Twitter text and URL. The share image is
 * named explicitly because a page that declares `openGraph` stops inheriting
 * the file-convention image.
 */
export function pageMetadata({
  locale,
  path,
  title,
  description,
  supportedLocales = locales,
}: {
  locale: Locale;
  path: string;
  title: string;
  description: string;
  supportedLocales?: readonly Locale[];
}): Metadata {
  const url = absoluteUrl(`/${locale}${path}`);
  const image = absoluteUrl(`/${locale}/opengraph-image`);
  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: {
        ...Object.fromEntries(
          supportedLocales.map((l) => [htmlLang[l], absoluteUrl(`/${l}${path}`)]),
        ),
        'x-default': absoluteUrl(`/en${path}`),
      },
    },
    openGraph: {
      type: 'website',
      siteName: site.name,
      title,
      description,
      url,
      locale: htmlLang[locale],
      images: [{ url: image, width: 1200, height: 630, alt: site.name }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}
