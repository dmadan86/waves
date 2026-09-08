import type { NextConfig } from 'next';

/**
 * There is no user interface here. Every request is answered by the Hono router
 * mounted at `src/app/[[...route]]/route.ts`, and Next is present only because
 * it is how `apps/web` and `apps/admin` already build and deploy — one project
 * shape, one workflow, one `vercel.json`.
 *
 * The response headers a browser cares about are set per surface in `src/app.ts`
 * (CORS differs between the public API and the console's own endpoints), so this
 * file adds only the ones that are true of every response regardless of caller.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  headers: async () => [
    {
      source: '/:path*',
      headers: [
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Frame-Options', value: 'DENY' },
      ],
    },
  ],
};

export default nextConfig;
