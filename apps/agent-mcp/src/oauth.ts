/**
 * What a remote MCP server has to say about who may call it.
 *
 * An agent belonging to somebody else cannot use the stdio server: that one
 * reads a session off one machine's disk, and giving it away gives away a
 * ledger. The remote one instead takes a bearer token per request, and the
 * whole point of the OAuth 2.1 shape is that the server never sees a password,
 * never stores a session, and can be handed to a stranger's assistant safely.
 *
 * Two documents make that work, and both are pure functions of the URLs
 * involved — no network, no secrets — so they are here rather than inside a
 * route handler, and can be tested for the mistakes that are otherwise found
 * by a client refusing to connect for reasons it does not explain.
 *
 * The MCP authorization spec builds directly on OAuth 2.0 Protected Resource
 * Metadata (RFC 9728): the server publishes where its tokens come from, the
 * client fetches that, discovers the authorization server from it, and
 * registers itself. Nobody exchanges an API key, and we never hold one.
 */

/**
 * Where GoTrue lives under a Supabase project, and therefore the issuer it
 * claims. Not a guess: it is the `issuer` field of that server's own metadata.
 */
const AUTH_PATH = '/auth/v1';

/** RFC 9728 §2 — the document a client fetches to find the authorization server. */
export interface ProtectedResourceMetadata {
  readonly resource: string;
  readonly authorization_servers: readonly string[];
  readonly bearer_methods_supported: readonly string[];
  readonly scopes_supported: readonly string[];
  readonly resource_documentation?: string;
}

/**
 * Describe this MCP endpoint to a client that has never seen it.
 *
 * `resource` must be the endpoint's own URL, exactly as clients call it: it is
 * checked against the token's audience, and a trailing slash or a stray `/mcp`
 * in the wrong place is a mismatch a client reports as an opaque refusal.
 *
 * @param mcpUrl the endpoint, e.g. `https://app.wavs.co.in/api/mcp`
 * @param supabaseUrl the project, e.g. `https://<ref>.supabase.co`. The
 *   authorization server is GoTrue *under* it — see `AUTH_PATH` below for why
 *   this function appends a path rather than advertising the apex.
 */
export function protectedResourceMetadata(
  mcpUrl: string,
  supabaseUrl: string,
  documentation?: string,
): ProtectedResourceMetadata {
  return {
    resource: trimSlash(mcpUrl),
    // Supabase Auth is the authorization server: it holds the accounts, and the
    // tokens it mints are ordinary Supabase JWTs, so every RLS policy in this
    // repo applies to an agent's request unchanged. That is the reason this
    // whole thing is small.
    //
    // `/auth/v1`, and not the project's apex, because that is the issuer GoTrue
    // actually claims:
    //
    //     "issuer": "https://<ref>.supabase.co/auth/v1"
    //
    // A client reads this array and goes looking for that server's own
    // metadata. RFC 8414 §3 builds the URL by inserting the well-known segment
    // *before* the issuer's path, so the issuer above resolves to
    // `/.well-known/oauth-authorization-server/auth/v1` — which answers 200.
    // Advertising the apex sent it to `/.well-known/oauth-authorization-server`
    // instead, which is a 404 on a Supabase project, and the whole chain stopped
    // one step after our own document. The refusal a client reports for that is
    // "no authorization server", which points at the wrong half of the system.
    authorization_servers: [`${trimSlash(supabaseUrl)}${AUTH_PATH}`],
    bearer_methods_supported: ['header'],
    // The scopes Supabase's OAuth server issues. Waves does not subdivide
    // further: what an agent may do is decided by RLS and by the ceilings in
    // `waves_assert_agent_cap`, not by a scope string a client asks itself for.
    scopes_supported: ['openid', 'email', 'profile'],
    ...(documentation ? { resource_documentation: documentation } : {}),
  };
}

/**
 * The `WWW-Authenticate` value that turns a 401 into a working sign-in.
 *
 * This header is the entire discovery mechanism: a client with no token calls
 * the endpoint, is refused, and reads from the refusal where to go and get one.
 * Omit it and the client has nothing to go on — which looks, from the outside,
 * exactly like a server that is simply broken.
 */
export function challengeHeader(metadataUrl: string, error?: string): string {
  const parts = [`Bearer resource_metadata="${metadataUrl}"`];
  if (error) parts.push(`error="${error}"`);
  return parts.join(', ');
}

/** Where the metadata document lives for a given endpoint (RFC 9728 §3). */
export function metadataUrlFor(mcpUrl: string): string {
  const url = new URL(mcpUrl);
  // The well-known segment goes after the host and *before* the path, so an
  // endpoint at `/api/mcp` publishes at `/.well-known/…/api/mcp`. Appending it
  // to the path instead produces a URL every compliant client will miss.
  const path = trimSlash(url.pathname);
  return `${url.origin}/.well-known/oauth-protected-resource${path === '' ? '' : path}`;
}

/** The bearer token from an Authorization header, or null if there isn't one. */
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (trimmed.length < 'Bearer '.length) return null;
  if (trimmed.slice(0, 6).toLowerCase() !== 'bearer') return null;
  const separator = trimmed.charAt(6);
  if (separator !== ' ' && separator !== '\t') return null;
  const token = trimmed.slice(7).trim();
  return token ? token : null;
}

function trimSlash(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
}
