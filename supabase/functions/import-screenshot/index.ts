/**
 * import-screenshot — see handler.ts. This file only wires the real dependencies.
 *
 * Secrets: OPENROUTER_API_KEY (function env, never in the app). Optional
 * IMPORT_VISION_MODEL (comma-separated) to change the models without a deploy.
 */

import { asCaller, asService, errorResponse, serveWithCors } from '../_shared/auth.ts';
import { enforceRateLimit } from '../_shared/rateLimit.ts';
import { handleImportScreenshot } from './handler.ts';

serveWithCors(async (request) => {
  try {
    const service = asService();
    return await handleImportScreenshot(request, {
      env: (name) => Deno.env.get(name),
      caller: asCaller(request),
      service,
      fetch,
      now: () => Date.now(),
      rateLimit: (profileId) => enforceRateLimit(service, request, 'import-screenshot', profileId),
    });
  } catch (error) {
    return errorResponse(error, { fn: 'import-screenshot' });
  }
});
