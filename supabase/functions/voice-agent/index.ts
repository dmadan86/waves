/**
 * voice-agent — see handler.ts. This file only wires the real dependencies.
 *
 * Secrets: OPENROUTER_API_KEY / GEMINI_API_KEY / DEEPSEEK_API_KEY / ANTHROPIC_API_KEY,
 * DEEPGRAM_API_KEY (function env, never in the app). Failure drills:
 * VOICE_CHAOS_ENABLED + VOICE_CHAOS (allowlisted accounts only, see
 * docs/voice-failure-modes.md).
 */

import { asCaller, asService, errorResponse, serveWithCors } from '../_shared/auth.ts';
import { enforceRateLimit } from '../_shared/rateLimit.ts';
import { handleVoiceAgent } from './handler.ts';

const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
  .EdgeRuntime;

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
      waitUntil: (work) => runtime?.waitUntil?.(work),
    });
  } catch (error) {
    return errorResponse(error, { fn: 'voice-agent' });
  }
});
