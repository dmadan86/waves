/**
 * The one Next.js route, and the whole reason this app is a Next app at all.
 *
 * Every path lands here and is handed to the Hono router in `src/app.ts`. Next
 * is carrying nothing but the build and the deploy target — which is exactly
 * what is wanted: `apps/web` and `apps/admin` already deploy this way, with the
 * same `vercel.json`, the same ignored-build-step diff and the same workflow, so
 * a new service is a new project rather than a new kind of thing to operate.
 *
 * `nodejs` rather than the edge runtime because the credential code signs with
 * `node:crypto` and compares tags with `timingSafeEqual`. `force-dynamic`
 * because every response here depends on an Authorization header, and a cached
 * one would be somebody else's ledger.
 */

import { handle } from 'hono/vercel';

import { createApp } from '../../app';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = handle(createApp());

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;
export const OPTIONS = handler;
