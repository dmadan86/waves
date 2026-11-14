import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';

/**
 * Every page that reads data is a client component, and that is a decision
 * rather than a default.
 *
 * Reads happen in the visitor's browser under their own session, so RLS is
 * what decides what they see (ADR-013). Rendering a group on the server would
 * need a key of its own, and the only key able to render somebody else's group
 * is one that must never leave an edge function (TDR §11). Nothing is gained
 * by moving the fetch: the page is behind an invite token either way.
 *
 * The layout and the home page are the exception, and read nothing: they are
 * server components solely so `Accept-Language` can decide `lang` and `dir`
 * before the first paint. A language guessed twice — once on the server and
 * again from `navigator.language` — is a page that visibly changes its mind.
 *
 * A static export would have been simpler still, but the invite links already
 * in circulation are `/join/<token>` — a dynamic segment whose values cannot
 * be known at build time. Changing the link shape to a query string would
 * break every link already sent.
 */
/**
 * Response security headers for every route.
 *
 * This app is a public SPA behind an invite token, so the headers are the
 * conservative, framework-agnostic set that cannot break script loading:
 * HSTS to pin HTTPS, `nosniff`, a strict referrer policy, and clickjacking
 * protection via both `X-Frame-Options` and a CSP `frame-ancestors 'none'`.
 * `upgrade-insecure-requests` is the only CSP directive here — a full
 * script/style CSP needs per-request nonces this static config cannot mint,
 * and a wrong one would silently break hydration, so it is deliberately left
 * to a follow-up rather than shipped untested.
 */
const SECURITY_HEADERS = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; upgrade-insecure-requests" },
  // The app is behind a sign-in and invite tokens; none of it belongs in a search index.
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

/**
 * The app is served from the marketing site's own origin, under `/app`, so
 * signing in on the site *is* the app session (same origin: one localStorage,
 * one PKCE verifier, no token hand-off). The site proxies `/app/*` to this
 * deployment (website/next.config.ts); `basePath` makes every page, `_next`
 * asset and API route live under that prefix. Set NEXT_PUBLIC_BASE_PATH to an
 * empty string for a self-host that owns its whole origin, and for the e2e run.
 */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '/app';

/** The host the app used to live on, and where the site that now serves it lives. */
const LEGACY_HOST = process.env.LEGACY_APP_HOST ?? 'app.wavs.co.in';
const LEGACY_ORIGIN = process.env.LEGACY_APP_ORIGIN ?? `https://${LEGACY_HOST}`;
const SITE_ORIGIN = process.env.SITE_ORIGIN ?? 'https://wavs.co.in';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  basePath: BASE_PATH,
  env: { NEXT_PUBLIC_BASE_PATH: BASE_PATH },
  headers: async () => [{ source: '/:path*', headers: SECURITY_HEADERS }],
  // Everything below exists only because the old host is still in the wild:
  // invite links, emails, store listings and registered MCP clients.
  redirects: async () =>
    BASE_PATH
      ? [
          {
            // Old links keep working, path and query kept (a #fragment survives
            // a redirect in the browser). Not redirected: the MCP endpoint and
            // `.well-known` documents, which clients and the OS fetch without
            // following redirects, and anything already under the base path.
            source: '/:path((?!api/mcp|\\.well-known/|app(?:/|$)).*)',
            has: [{ type: 'host', value: LEGACY_HOST }],
            destination: `${SITE_ORIGIN}${BASE_PATH}/:path`,
            permanent: false,
            basePath: false,
          },
        ]
      : [],
  rewrites: async () => ({
    beforeFiles: BASE_PATH
      ? [
          // Registered OAuth/MCP clients and the app-link verifiers use these
          // exact URLs on the old host; serve them there rather than move them.
          // Next cannot rewrite from outside the base path to inside it, so this
          // is a proxy to this same deployment (not a redirect, which an MCP
          // client or Apple's CDN may refuse to follow). `/app/...` does not
          // match these sources, so there is no loop. shortcut: one extra hop
          // on these three URLs; a vercel.json rewrite would avoid it.
          {
            source: '/api/mcp',
            destination: `${LEGACY_ORIGIN}${BASE_PATH}/api/mcp`,
            basePath: false,
          },
          {
            source: '/.well-known/:path*',
            destination: `${LEGACY_ORIGIN}${BASE_PATH}/.well-known/:path*`,
            basePath: false,
          },
        ]
      : [],
    afterFiles: [],
    fallback: [],
  }),
};

/**
 * Source-map upload needs an organisation, a project and a write token, none of
 * which belong in the repository. Without them the build is left alone rather
 * than half-wired: reporting still works — it just arrives minified — and a
 * clone with no Sentry account builds exactly as it did before.
 */
const sentryConfigured = Boolean(process.env.SENTRY_ORG && process.env.SENTRY_PROJECT);

export default sentryConfigured
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      // Sentry's own domain is a popular thing to block, and a blocked report
      // is one nobody knows was lost.
      tunnelRoute: '/monitoring',
      silent: !process.env.CI,
    })
  : nextConfig;
