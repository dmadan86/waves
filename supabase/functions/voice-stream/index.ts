/**
 * voice-stream — see handler.ts. This file only wires the real dependencies.
 *
 * Secrets: DEEPGRAM_API_KEY (any key with usage:write; it never leaves here).
 * Deployed with `verify_jwt = false` (supabase/config.toml): a WebSocket upgrade
 * cannot carry an Authorization header, so the handler verifies the caller's
 * token itself before anything is spent.
 *
 * Plain `Deno.serve`, not `serveWithCors`: CORS does not apply to WebSockets,
 * and the 101 upgrade response is not one to add headers to.
 */

import { asCallerFromToken, asService, errorResponse } from '../_shared/auth.ts';
import { enforceRateLimit } from '../_shared/rateLimit.ts';
import { handleVoiceStream, type RelaySocket } from './handler.ts';

const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
  .EdgeRuntime;

Deno.serve(async (request) => {
  try {
    const service = asService();
    return handleVoiceStream(request, {
      env: (name) => Deno.env.get(name),
      service,
      callerFor: asCallerFromToken,
      rateLimit: (profileId) => enforceRateLimit(service, request, 'voice-stream', profileId),
      upgrade: (req, protocol) => {
        // The edge runtime refuses `{ protocol }` ("not in the request's protocol
        // list") even when the client offered it, failing every upgrade with a
        // 502. Upgrade without it and echo the protocol ourselves; the app's
        // sockets (OkHttp, SocketRocket) accept the 101 either way.
        const { socket, response } = Deno.upgradeWebSocket(req);
        if (protocol) {
          try {
            response.headers.set('sec-websocket-protocol', protocol);
          } catch {
            // Immutable headers: nothing to echo, and nothing the app needs.
          }
        }
        return { socket: socket as unknown as RelaySocket, response };
      },
      // Deepgram's documented browser form: the key as the 'token' subprotocol.
      connectUpstream: (url, key) => new WebSocket(url, ['token', key]) as unknown as RelaySocket,
      // The worker must outlive the 101 response until both sockets close.
      waitUntil: (work) => runtime?.waitUntil?.(work),
    });
  } catch (error) {
    return errorResponse(error, { fn: 'voice-stream' });
  }
});
