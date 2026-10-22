/**
 * AI assistants the signed-in person has authorised over Supabase Auth's
 * OAuth 2.1 server (the MCP connector at wavs.co.in/mcp), and the one thing
 * that can be done with them: disconnect.
 *
 * Nothing here imports the Supabase client. The caller hands over
 * `supabase.auth.oauth`, so the list/revoke logic runs under a plain mock and
 * the screen stays the only file that needs React Native.
 */

/** The slice of `supabase.auth.oauth` this feature uses. */
export interface OAuthGrantsApi {
  listGrants(): Promise<{
    data: readonly RawGrant[] | null;
    error: { message: string } | null;
  }>;
  revokeGrant(options: { clientId: string }): Promise<{ error: { message: string } | null }>;
}

/** An `OAuthGrant` as the server returns it. */
export interface RawGrant {
  client: {
    id: string;
    name: string;
    uri?: string | null;
    logo_uri?: string | null;
  };
  scopes: readonly string[];
  granted_at: string;
}

export interface ConnectedApp {
  clientId: string;
  /** Blank when the client registered without a name; the screen supplies a fallback. */
  name: string;
  /** Only ever an https URL; anything else is dropped rather than rendered. */
  logoUri: string | null;
  scopes: string[];
  grantedAt: string;
}

/** The registered logo is somebody else's string: render it only if it is https. */
function httpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

/** Newest grant first; an unreadable date sorts last. */
function grantedTime(app: ConnectedApp): number {
  const at = Date.parse(app.grantedAt);
  return Number.isNaN(at) ? -Infinity : at;
}

export async function listConnectedApps(api: OAuthGrantsApi): Promise<ConnectedApp[]> {
  const { data, error } = await api.listGrants();
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((grant) => ({
      clientId: grant.client.id,
      name: grant.client.name?.trim() ?? '',
      logoUri: httpsUrl(grant.client.logo_uri),
      scopes: [...(grant.scopes ?? [])],
      grantedAt: grant.granted_at,
    }))
    .sort((a, b) => grantedTime(b) - grantedTime(a));
}

/**
 * Revoke consent, end that client's sessions and kill its refresh tokens. Throws
 * on failure so the caller never drops a row the server still honours.
 */
export async function disconnectApp(api: OAuthGrantsApi, clientId: string): Promise<void> {
  const { error } = await api.revokeGrant({ clientId });
  if (error) throw new Error(error.message);
}

/** The list without the app just disconnected. */
export function withoutApp(apps: readonly ConnectedApp[], clientId: string): ConnectedApp[] {
  return apps.filter((app) => app.clientId !== clientId);
}

/** Where the empty state sends people to learn how to connect an assistant. */
export const CONNECT_GUIDE_URL = 'https://wavs.co.in/mcp';

/**
 * What the Settings row says under "Connected apps": how many assistants have
 * access. `null` while the list is unread or failed to load, so the caller
 * keeps its generic hint -- "None connected" about a fetch that never
 * succeeded would be a false comfort.
 */
export function connectedAppsRowHint(
  count: number | undefined,
  none: string,
  format: (count: number) => string,
): string | null {
  if (count === undefined) return null;
  return count === 0 ? none : format(count);
}
