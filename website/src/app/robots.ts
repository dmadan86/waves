import type { MetadataRoute } from 'next';

import { absoluteUrl } from '@/lib/site';

// Named explicitly so the intent survives a future edit of the wildcard rule.
const aiCrawlers = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'PerplexityBot',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
];

/**
 * Everything is crawlable, and that is a position rather than a default: the
 * point of the markdown twin at `/{locale}/index.md` and of `/llms.txt` is that
 * we would rather an assistant answer a question about Waves from our own words
 * than guess at them.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: ['*', ...aiCrawlers], allow: '/' }],
    sitemap: absoluteUrl('/sitemap.xml'),
    host: absoluteUrl(),
  };
}
