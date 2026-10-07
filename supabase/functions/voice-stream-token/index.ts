/**
 * voice-stream-token — see handler.ts. This file only wires the real dependencies.
 *
 * Secrets: DEEPGRAM_API_KEY (a key allowed to mint temporary tokens).
 */

import { asCaller, asService, errorResponse, serveWithCors } from '../_shared/auth.ts';
import { enforceRateLimit } from '../_shared/rateLimit.ts';
import { handleVoiceStreamToken } from './handler.ts';

serveWithCors(async (request) => {
  try {
    const service = asService();
    return await handleVoiceStreamToken(request, {
      env: (name) => Deno.env.get(name),
      caller: asCaller(request),
      service,
      fetch,
      rateLimit: (profileId) => enforceRateLimit(service, request, 'voice-stream-token', profileId),
    });
  } catch (error) {
    return errorResponse(error, { fn: 'voice-stream-token' });
  }
});
