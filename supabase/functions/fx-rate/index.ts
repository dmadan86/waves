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

serveWithCors((request) =>
  handleFxRate(request, {
    callerId: async (incoming) => {
      const { data } = await asCaller(incoming).auth.getUser();
      return data?.user?.id ?? null;
    },
    rateLimit: (incoming, userId) => enforceRateLimit(asService(), incoming, 'fx-rate', userId),
    // `fx_daily_rates` is service-role only: RLS on, no client grants.
    store: () => supabaseFxStore(asService()),
    fetchFn: fetch,
  }),
);
