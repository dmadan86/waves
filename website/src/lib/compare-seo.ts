import type { Metadata } from 'next';

import { absoluteUrl, site } from '@/lib/site';

/**
 * Metadata for the English-only compare pages. The share image is named
 * explicitly: a page that declares its own `openGraph` stops inheriting the
 * file-convention image from `[locale]/opengraph-image.tsx`.
 *
 * `title.absolute` skips the layout's "%s · Waves" template so the 60-character
 * budget is the whole title.
 */
export function socialMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const url = absoluteUrl(`/en${path}`);
  const image = absoluteUrl('/en/opengraph-image');
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      siteName: site.name,
      title,
      description,
      url,
      locale: 'en',
      images: [{ url: image, width: 1200, height: 630, alt: 'Waves' }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
    robots: { index: true, follow: true },
  };
}
