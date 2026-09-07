/**
 * Where this machine keeps a session, so the server can be started without
 * anybody hand-carrying a JWT.
 *
 * The env vars (`WAVES_SUPABASE_ACCESS_TOKEN` and friends) remain the way a
 * deployment supplies a session. They are a poor way for a *person* to try the
 * thing: it means extracting a token from a signed-in device and pasting it
 * into a config file, where it stays until it is stale. `login.ts` writes this
 * file instead, and `readEnv` falls back to it.
 *
 * The refresh token in here mints access tokens indefinitely. Owner-only
 * permissions are the whole of its protection, which is enough for one
 * developer's laptop and is not enough for anything else — the reason the
 * OAuth 2.1 path (README) is the real answer for other people's agents.
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface StoredSession {
  /** The project this session belongs to. Kept so a login is self-describing. */
  url: string;
  /** The publishable (anon) key — public by design; RLS is what protects rows. */
  anonKey: string;
  accessToken: string;
  refreshToken: string;
  /** Whose session it is, for the "signed in as" line. Never used to authorize. */
  email?: string;
}

export const STORE_PATH = join(homedir(), '.waves-mcp', 'session.json');

export function readStore(): StoredSession | null {
  try {
    const parsed = JSON.parse(readFileSync(STORE_PATH, 'utf8')) as Partial<StoredSession>;
    if (!parsed.url || !parsed.anonKey || !parsed.accessToken || !parsed.refreshToken) return null;
    return parsed as StoredSession;
  } catch {
    return null;
  }
}

export function writeStore(session: StoredSession): void {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  writeFileSync(STORE_PATH, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
  // `mode` applies only when the file is created; an existing file keeps the
  // permissions it already had, so restate them.
  try {
    chmodSync(STORE_PATH, 0o600);
  } catch {
    // Windows has no POSIX mode. The file still lands in the user's profile.
  }
}
