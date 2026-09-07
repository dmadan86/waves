/**
 * Where an AI agent finds out how to authenticate to this server.
 *
 * RFC 9728. A client that wants to call `/api/mcp` and has no token gets a 401
 * naming this URL; it fetches this document, learns that Supabase Auth is the
 * authorization server, fetches *that* server's metadata, registers itself and
 * runs an ordinary authorization-code flow with PKCE. Nobody emails anybody an
 * API key, and Waves never holds one.
 *
 * The path looks odd and is not negotiable: the well-known segment goes between
 * the host and the resource's path, so an endpoint at `/api/mcp` publishes at
 * `/.well-known/oauth-protected-resource/api/mcp`. Put it anywhere else and
 * compliant clients will look straight past it, which presents as a connector
 * that simply refuses to connect.
 */

import { protectedResourceMetadata } from '@waves/agent-mcp/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  const origin = new URL(request.url).origin;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    return Response.json(
      { error: 'This deployment has no Supabase project configured.' },
      { status: 500 },
    );
  }

  return Response.json(
    protectedResourceMetadata(
      `${origin}/api/mcp`,
      supabaseUrl,
      'https://github.com/dmadan86/waves/blob/main/apps/agent-mcp/README.md',
    ),
    {
      headers: {
        // Public, and stable for a given deployment. Clients fetch it on every
        // fresh connection; a few minutes of caching saves a function
        // invocation without making a redeploy slow to take effect.
        'Cache-Control': 'public, max-age=300',
      },
    },
  );
}
