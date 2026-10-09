/**
 * fx-rate entrypoint — the thin `Deno.serve` shell.
 *
 * The handling lives in `handler.ts` (lookup order, the daily cache, the stale
 * fallback) and `providers.ts` (the provider chain and the exact-fraction
 * conversion), both over injected boundaries so they are tested on Node.
 */

import { asCaller, asService, serveWithCors } from '../_shared/auth.ts';
import { enforceRateLimit } from '../_shared/rateLimit.ts';
import { handleFxRate, supabaseFxStore } from './handler.ts';

/**
 * One service client per isolate, built on first use rather than per request
 * (or at import, where a missing secret would take the whole function down).
 * The handler builds the store inside its cache guard, so a throw here is a
 * cache miss.
 */
let service: ReturnType<typeof asService> | null = null;
const serviceClient = (): ReturnType<typeof asService> => (service ??= asService());

serveWithCors((request) =>
  handleFxRate(request, {
    callerId: async (incoming) => {
      const { data } = await asCaller(incoming).auth.getUser();
      return data?.user?.id ?? null;
    },
    rateLimit: (incoming, userId) => enforceRateLimit(serviceClient(), incoming, 'fx-rate', userId),
    // `fx_daily_rates` is service-role only: RLS on, no client grants.
    store: () => supabaseFxStore(serviceClient()),
    fetchFn: fetch,
  }),
);
