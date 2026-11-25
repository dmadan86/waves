import type { NextConfig } from 'next';

/**
 * The marketing site is static-first: every page is a server component with no
 * data fetching, so the whole thing prerenders at build time and Vercel serves
 * it from the edge cache. Nothing here needs a runtime.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Guessed short compare URLs (/en/compare/splitwise) go to the real page.
  async redirects() {
    return [
      {
        source:
          '/:locale/compare/:slug(splitwise|tricount|settle-up|splid|spliit|kittysplit|splitkaro|google-pay|phonepe|venmo|spreadsheets)',
        destination: '/:locale/compare/waves-vs-:slug',
        permanent: true,
      },
      { source: '/:locale/home', destination: '/:locale/family', permanent: true },
    ];
  },
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
