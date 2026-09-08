import { NextResponse, type NextRequest } from 'next/server';

import { defaultLocale, locales } from './i18n/config';

/**
 * Every page lives under a locale segment, so a bare `/` has to become
 * `/en`, `/ta`, `/hi` or `/ar`. The choice is made from `Accept-Language`
 * once and then redirected — a person who lands on `/ta` because they were
 * sent that link keeps Tamil, regardless of what their browser prefers.
 *
 * This was `middleware.ts`; Next 16 deprecated that name in favour of `proxy`.
 */

const PUBLIC_FILE = /\.[^/]+$/;

/**
 * Content negotiation for the markdown twin.
 *
 * An agent that says it would rather have `text/markdown` than `text/html`
 * gets the markdown; everything else gets the page. The decision is made from
 * the `Accept` header and its q-values only — never from the user agent, which
 * would be cloaking — and the response carries `Vary: Accept` so a cache keeps
 * the two apart.
 */
function prefersMarkdown(accept: string | null): boolean {
  if (!accept?.includes('markdown')) return false;

  const weights = new Map<string, number>();
  for (const part of accept.split(',')) {
    const [type, ...params] = part.trim().split(';');
    const q = params.find((param) => param.trim().startsWith('q='));
    weights.set(type.trim().toLowerCase(), q ? (Number.parseFloat(q.split('=')[1]) ?? 1) : 1);
  }

  const markdown = weights.get('text/markdown') ?? 0;
  const html = Math.max(weights.get('text/html') ?? 0, weights.get('*/*') ?? 0);
  return markdown > 0 && markdown >= html;
}

function negotiate(header: string | null): string {
  if (!header) return defaultLocale;

  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return { tag: tag.toLowerCase(), q: q ? Number.parseFloat(q.split('=')[1]) || 0 : 1 };
    })
    // `q=0` is an explicit refusal of that language, not a weak preference.
    .filter((entry) => entry.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    const base = tag.split('-')[0];
    const match = locales.find((locale) => locale === base);
    if (match) return match;
  }

  return defaultLocale;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/_next') || pathname.startsWith('/api') || PUBLIC_FILE.test(pathname)) {
    return NextResponse.next();
  }

  const hasLocale = locales.some(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  );

  if (hasLocale) {
    const locale = pathname.split('/')[1];

    if (pathname === `/${locale}` && prefersMarkdown(request.headers.get('accept'))) {
      const url = request.nextUrl.clone();
      url.pathname = `/${locale}/index.md`;
      const rewritten = NextResponse.rewrite(url);
      rewritten.headers.set('Vary', 'Accept');
      return rewritten;
    }

    const response = NextResponse.next();
    // A headless reader looks at this header; a DOM crawler looks at the
    // <link> in the document head. Both are published and point at the same URL.
    response.headers.set(
      'Link',
      `<${request.nextUrl.origin}/${locale}/index.md>; rel="alternate"; type="text/markdown"`,
    );
    // Deliberately no `Vary: Accept` here. Browsers send wildly different
    // Accept headers, so varying the HTML on it would shred the CDN's hit rate
    // to guard against a failure that is only ever "an agent got the HTML".
    // The markdown response above does carry it, which is the direction that
    // matters: a cached markdown body must never be served to a browser.
    return response;
  }

  const locale = negotiate(request.headers.get('accept-language'));
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;

  const response = NextResponse.redirect(url);
  // The destination depends on the request's own Accept-Language, so a shared
  // cache must not hand one visitor's redirect to the next visitor.
  response.headers.set('Vary', 'Accept-Language');
  return response;
}

export const config = {
  matcher: ['/((?!_next|api|.*\\..*).*)'],
};
