/** Read only after Supabase getUser has verified the JWT signature and expiry. */
export function agentClientId(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload: unknown = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
    const id = (payload as Record<string, unknown>).client_id;
    return typeof id === 'string' && id.trim() ? id : null;
  } catch {
    return null;
  }
}
