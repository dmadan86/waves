/**
 * spending-ask — see handler.ts. This file only wires the real dependencies.
 *
 * Secrets: OPENROUTER_API_KEY (function env, never in the app). Optional
 * SPENDING_ASK_MODEL (comma-separated) to change the model without a deploy.
 */

import { asCaller, asService, errorResponse, serveWithCors } from '../_shared/auth.ts';
import { enforceRateLimit } from '../_shared/rateLimit.ts';
import { handleSpendingAsk } from './handler.ts';

serveWithCors(async (request) => {
  try {
    const service = asService();
    return await handleSpendingAsk(request, {
      env: (name) => Deno.env.get(name),
      caller: asCaller(request),
      service,
      fetch,
      now: () => Date.now(),
      rateLimit: (profileId) => enforceRateLimit(service, request, 'spending-ask', profileId),
    });
  } catch (error) {
    return errorResponse(error, { fn: 'spending-ask' });
  }
});
