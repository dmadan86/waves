/**
 * Sign this machine in, once, with a code from your own inbox.
 *
 * Deliberately a terminal command and not a tool. An MCP server speaks
 * JSON-RPC over stdin and stdout — there is no channel on which it could ask a
 * human for a six-digit code — and an agent that could *start* a login is an
 * agent that could be talked into starting one for somebody else's address.
 *
 * Without this, trying the server meant extracting a JWT from a signed-in
 * device by hand and pasting it into a config file, where it went stale in an
 * hour. That is a fine way to configure a deployment and a terrible way to find
 * out whether the idea works.
 */

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { createClient } from '@supabase/supabase-js';

import { readStore, writeStore, STORE_PATH } from './store';

/**
 * Which project to sign in to. Flags win, then the environment, then whatever
 * the last sign-in used — so signing in again is `login` with no arguments.
 */
function target(): { url: string; anonKey: string } {
  const flag = (name: string): string | undefined =>
    process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

  const previous = readStore();
  const url =
    flag('url') ??
    process.env.WAVES_SUPABASE_URL ??
    process.env.EXPO_PUBLIC_SUPABASE_URL ??
    previous?.url;
  const anonKey =
    flag('key') ??
    process.env.WAVES_SUPABASE_ANON_KEY ??
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
    previous?.anonKey;

  if (!url || !anonKey) {
    throw new Error(
      'Point this at a project first:\n' +
        '  pnpm --filter @waves/agent-mcp login --url=https://<ref>.supabase.co --key=<publishable key>\n' +
        '(or set WAVES_SUPABASE_URL and WAVES_SUPABASE_ANON_KEY)',
    );
  }
  return { url, anonKey };
}

async function main(): Promise<void> {
  const { url, anonKey } = target();
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const ask = createInterface({ input: stdin, output: stdout });
  try {
    const email = (await ask.question('Email you use for Waves: ')).trim();
    if (!email) throw new Error('No email, no code.');

    const { error: sendError } = await client.auth.signInWithOtp({
      email,
      // False, exactly as on the app's login door: a typo must not silently
      // mint a new empty account with no groups and no history.
      options: { shouldCreateUser: false },
    });
    if (sendError) throw new Error(`Could not send the code: ${sendError.message}`);

    const code = (await ask.question('Six-digit code from that inbox: ')).trim();
    const { data, error } = await client.auth.verifyOtp({ email, token: code, type: 'email' });
    if (error) throw new Error(`That code did not work: ${error.message}`);
    if (!data.session) throw new Error('No session came back. Try again.');

    writeStore({
      url,
      anonKey,
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      email: data.session.user?.email ?? email,
    });
    stdout.write(`\nSigned in as ${email}.\nSession stored at ${STORE_PATH} (owner-only).\n`);
  } finally {
    ask.close();
  }
}

main().catch((error: unknown) => {
  stdout.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
