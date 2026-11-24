import type { NextConfig } from 'next';

/**
 * The marketing site is static-first: every page is a server component with no
 * data fetching, so the whole thing prerenders at build time and Vercel serves
 * it from the edge cache. Nothing here needs a runtime.
 */
/**
 * The web app (apps/web, built with basePath `/app`) is its own deployment, and
 * this site serves it under `/app` on the same origin: signing in here is the
 * app session. WEB_APP_ORIGIN is that deployment's address and must not be the
 * old app host (app.wavs.co.in), which redirects back here. Unset, `/app` 404s.
 * `beforeFiles` so `/app` beats the `[locale]` segment.
 */
const WEB_APP_ORIGIN = process.env.WEB_APP_ORIGIN;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  rewrites: async () => ({
    beforeFiles: WEB_APP_ORIGIN
      ? [
          { source: '/app', destination: `${WEB_APP_ORIGIN}/app` },
          { source: '/app/:path*', destination: `${WEB_APP_ORIGIN}/app/:path*` },
        ]
      : [],
    afterFiles: [],
    fallback: [],
  }),
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
