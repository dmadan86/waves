import type { MetadataRoute } from 'next';

import { absoluteUrl } from '@/lib/site';

/**
 * Everything is crawlable, and that is a position rather than a default: the
 * point of the markdown twin at `/{locale}/index.md` and of `/llms.txt` is that
 * we would rather an assistant answer a question about Waves from our own words
 * than guess at them.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: absoluteUrl('/sitemap.xml'),
    host: absoluteUrl(),
  };
}
