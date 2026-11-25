import type { MetadataRoute } from 'next';

import { htmlLang } from '@/i18n/config';
import { competitors, compareSlug } from '@/content/competitors';
import { useCases } from '@/content/use-cases';
import { routeLocales } from '@/lib/route-locales';
import { absoluteUrl } from '@/lib/site';

// `/delete-account` is listed on purpose. Google Play requires the deletion URL
// to be publicly reachable and findable, and a page reachable only by someone
// who already has the link is neither.
// `/mcp` is listed for the same reason as the line above it, minus the
// obligation: somebody whose assistant refuses to connect goes looking for the
// page, and a help page nobody can find is a support email instead.
const compareChecked = new Date('2026-10-25');
const isSeoLanding = (p: string) =>
  p.startsWith('/compare') || p.startsWith('/alternatives') || p.startsWith('/use-cases');

const paths = [
  '',
  '/privacy',
  '/terms',
  '/refund',
  '/support',
  '/delete-account',
  '/mcp',
  '/companies',
  '/personal',
  '/family',
  '/compare',
  ...competitors.map((c) => `/compare/${compareSlug(c)}`),
  '/alternatives/splitwise-alternative',
  '/press',
  ...useCases.map((u) => `/use-cases/${u.slug}`),
];

// lastModified is set only where a real date exists: the compare pages carry the
// date their competitor facts were checked. A blanket `new Date()` would claim
// every page changed on every build.
// English-only routes are listed once with no hreflang alternates.
export default function sitemap(): MetadataRoute.Sitemap {
  return paths.flatMap((path) => {
    const pathLocales = routeLocales(path);
    return pathLocales.map((locale) => ({
      url: absoluteUrl(`/${locale}${path}`),
      changeFrequency: path === '' ? ('weekly' as const) : ('monthly' as const),
      priority:
        path === ''
          ? 1
          : isSeoLanding(path)
            ? 0.8
            : ['/personal', '/companies'].includes(path)
              ? 0.7
              : 0.4,
      ...(path.startsWith('/compare/') || path.startsWith('/alternatives')
        ? { lastModified: compareChecked }
        : {}),
      ...(pathLocales.length > 1
        ? {
            alternates: {
              languages: Object.fromEntries(
                pathLocales.map((l) => [htmlLang[l], absoluteUrl(`/${l}${path}`)]),
              ),
            },
          }
        : {}),
    }));
  });
}
