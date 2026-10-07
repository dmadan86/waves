/**
 * voice-agent — see handler.ts. This file only wires the real dependencies.
 *
 * Secrets: ANTHROPIC_API_KEY, DEEPGRAM_API_KEY (function env, never in the app).
 */

import { asCaller, asService, errorResponse, serveWithCors } from '../_shared/auth.ts';
import { enforceRateLimit } from '../_shared/rateLimit.ts';
import { handleVoiceAgent } from './handler.ts';

serveWithCors(async (request) => {
  try {
    const service = asService();
    return await handleVoiceAgent(request, {
      env: (name) => Deno.env.get(name),
      caller: asCaller(request),
      service,
      fetch,
      now: () => Date.now(),
      rateLimit: (profileId) => enforceRateLimit(service, request, 'voice-agent', profileId),
    });
  } catch (error) {
    return errorResponse(error, { fn: 'voice-agent' });
  }
});
