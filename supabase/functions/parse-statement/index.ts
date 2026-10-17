/**
 * parse-statement — see handler.ts. This file only wires the real dependencies.
 *
 * Secrets: OPENROUTER_API_KEY (function env, never in the app). Optional
 * STATEMENT_IMPORT_MODEL / IMPORT_VISION_MODEL (comma-separated) to change the
 * models without a deploy, and STATEMENT_IMPORT_SIGNING_KEY for the
 * continuation tokens (falls back to the service-role key).
 */

import { asCaller, asService, errorResponse, serveWithCors } from '../_shared/auth.ts';
import { enforceRateLimit } from '../_shared/rateLimit.ts';
import { handleParseStatement } from './handler.ts';

serveWithCors(async (request) => {
  try {
    const service = asService();
    return await handleParseStatement(request, {
      env: (name) => Deno.env.get(name),
      caller: asCaller(request),
      service,
      fetch,
      now: () => Date.now(),
      rateLimit: (profileId) => enforceRateLimit(service, request, 'parse-statement', profileId),
    });
  } catch (error) {
    return errorResponse(error, { fn: 'parse-statement' });
  }
});
