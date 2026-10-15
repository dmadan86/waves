/**
 * receipt-parse entrypoint — the thin `Deno.serve` shell. The handling lives in
 * `handler.ts` as a function over injected dependencies (see `handler.test.ts`).
 */

import { asCaller, asService, errorResponse, serveWithCors } from '../_shared/auth.ts';
import { readObjectBytes } from '../_shared/r2.ts';
import { enforceRateLimit } from '../_shared/rateLimit.ts';
import { handleReceiptParse } from './handler.ts';

serveWithCors(async (request) => {
  try {
    const service = asService();
    return await handleReceiptParse(request, {
      env: (name) => Deno.env.get(name),
      caller: asCaller(request),
      service,
      fetch,
      rateLimit: (profileId) => enforceRateLimit(service, request, 'receipt-parse', profileId),
      readImage: (path) => readObjectBytes(service, 'receipts', path),
    });
  } catch (error) {
    return errorResponse(error, { fn: 'receipt-parse' });
  }
});
