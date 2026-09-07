/**
 * Waves, as a tool somebody else's AI agent can use — over the network, as
 * themselves.
 *
 * The stdio server (`apps/agent-mcp`) reads a session off one machine's disk.
 * That is fine for the person who owns the machine and useless for anybody
 * else: handing it out hands out a ledger. This endpoint is the other half.
 * Each request carries its own bearer token, minted by Supabase Auth's OAuth
 * 2.1 server for whoever is asking, and the server keeps nothing between
 * requests — no session, no key, nothing to leak.
 *
 * Three properties hold it up, and they are the same three as everywhere else
 * in this repo:
 *
 *   * **The token is the identity.** A Supabase client is built with the anon
 *     key and the caller's token, so RLS decides what that agent may see. There
 *     is no service-role key in this file, and there must never be one: a
 *     service key here would be every user's ledger behind one prompt.
 *   * **The tools are the same ones.** `buildWavesServer` is shared with the
 *     stdio entry, so a tool cannot behave differently depending on how the
 *     request arrived.
 *   * **Ceilings are server-side.** How much an agent may write is decided in
 *     the database (`waves_assert_agent_cap`), keyed off the `client_id` claim
 *     the OAuth server puts in the token. Nothing in this file can raise it,
 *     which is the point.
 *
 * Stateless by construction: a fresh transport per request, `sessionIdGenerator`
 * undefined. MCP's own session handling would mean holding state in a serverless
 * function that may not exist for the next request — the 2026-07-28 spec makes
 * the protocol core stateless for exactly this reason.
 */

import { createClient } from '@supabase/supabase-js';
import { serveMcpOverHttp } from '@waves/agent-mcp/http';
import { bearerToken, challengeHeader, metadataUrlFor } from '@waves/agent-mcp/oauth';
import { buildWavesServer } from '@waves/agent-mcp/tools';

// The transport speaks Web Request/Response, but the tools reach Supabase over
// ordinary fetch and the SDK is a Node package; nodejs is the runtime this is
// tested on.
export const runtime = 'nodejs';
// Every request is authorized on its own; nothing here may be cached.
export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** This endpoint's own URL, as clients call it — the audience of their tokens. */
function endpointUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.origin}/api/mcp`;
}

/**
 * A 401 that a client can act on.
 *
 * The `WWW-Authenticate` header is the whole of MCP's discovery: a client with
 * no token is refused, reads the metadata URL out of the refusal, and goes and
 * gets one. Without it a client has nothing to go on, and a server that refuses
 * without saying where to authenticate is indistinguishable from a broken one.
 */
function unauthorized(request: Request, error?: string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Authorization required' },
      id: null,
    }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': challengeHeader(metadataUrlFor(endpointUrl(request)), error),
      },
    },
  );
}

export async function POST(request: Request): Promise<Response> {
  if (!SUPABASE_URL || !ANON_KEY) {
    return Response.json(
      { error: 'This deployment has no Supabase project configured.' },
      { status: 500 },
    );
  }

  const token = bearerToken(request.headers.get('authorization'));
  if (!token) return unauthorized(request);

  // Built with the anon key and the caller's token — never the service key.
  // Every read and write from here carries this person's JWT, so the database
  // decides what the agent may do, exactly as it does for the app.
  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  // The one call that decides whether this token is real. Supabase verifies the
  // signature and expiry; a token this server cannot resolve to a user is not a
  // caller with fewer permissions, it is not a caller at all.
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return unauthorized(request, 'invalid_token');

  return serveMcpOverHttp(buildWavesServer(supabase, data.user.id, readOnly()), request);
}

/**
 * A remote agent may be limited to reads, without the write tools existing at
 * all — they never reach `tools/list`, so a model is not tempted to try one and
 * be refused.
 */
function readOnly(): boolean {
  return ['1', 'true', 'yes'].includes((process.env.WAVES_MCP_READONLY ?? '').toLowerCase());
}

/**
 * A GET is how a client opens the server-to-client stream. This server is
 * stateless and has nothing to push, so it says so in the protocol's own words
 * rather than returning a bare 405 the client has to guess at.
 */
export function GET(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'This server is stateless; POST your requests.' },
      id: null,
    }),
    { status: 405, headers: { 'Content-Type': 'application/json', Allow: 'POST' } },
  );
}
