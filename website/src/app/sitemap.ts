import type { MetadataRoute } from 'next';

import { htmlLang, locales } from '@/i18n/config';
import { absoluteUrl } from '@/lib/site';

// `/delete-account` is listed on purpose. Google Play requires the deletion URL
// to be publicly reachable and findable, and a page reachable only by someone
// who already has the link is neither.
// `/mcp` is listed for the same reason as the line above it, minus the
// obligation: somebody whose assistant refuses to connect goes looking for the
// page, and a help page nobody can find is a support email instead.
const paths = ['', '/privacy', '/terms', '/delete-account', '/mcp'] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return locales.flatMap((locale) =>
    paths.map((path) => ({
      url: absoluteUrl(`/${locale}${path}`),
      lastModified: new Date(),
      changeFrequency: path === '' ? ('weekly' as const) : ('yearly' as const),
      priority: path === '' ? 1 : 0.4,
      alternates: {
        languages: Object.fromEntries(
          locales.map((l) => [htmlLang[l], absoluteUrl(`/${l}${path}`)]),
        ),
      },
    })),
  );
}
