/**
 * The two things that are true of an AI agent's write and not of a person's.
 *
 * An agent acts through `apps/agent-mcp` holding a real user's token, so RLS
 * and the RPC boundary already decide what it may touch — and they decide it
 * correctly. What they do not decide is *how much* (a person mistypes an amount
 * once and sees it; a model mistypes it and retries) or leave any trace that
 * the write was not made by hand.
 *
 * Both hang off one fact: a token minted for a third-party client through
 * Supabase's OAuth 2.1 server carries a `client_id` claim, and one minted for
 * the app does not. The claim is read *in the database*, from the verified JWT
 * — see `waves_agent_client_id`. Nothing here decides who the caller is, which
 * is why nothing here can be tricked about it. Both calls go through the caller
 * client, never the service one: with the service role there is no user token
 * to read, so the ceiling would silently never apply.
 *
 * For the app itself both functions are no-ops, which is what lets this ship
 * before the OAuth server is switched on.
 */

import { HttpError, type SupabaseClient } from './auth.ts';

/**
 * Refuse a write that is beyond what an assistant may do — too large on its
 * own, or enough to take the day past its total.
 *
 * The database raises `AGENT_CAP_SINGLE` / `AGENT_CAP_DAILY`; both become a 403
 * carrying that code, because a model reading "forbidden" learns nothing and a
 * model reading the code can tell the person which limit it hit.
 */
export async function assertAgentCap(
  caller: SupabaseClient,
  amountMinor: bigint | null,
): Promise<void> {
  if (amountMinor === null) return;
  const { error } = await caller.rpc('waves_assert_agent_cap', {
    p_amount_minor: amountMinor.toString(),
  });
  if (!error) return;
  const code = /\b(AGENT_CAP_[A-Z]+)\b/.exec(error.message)?.[1];
  if (code) {
    throw new HttpError(403, code, error.message.replace(/^[A-Z_]+:\s*/, ''));
  }
  throw new HttpError(500, 'AGENT_CAP_CHECK_FAILED', error.message);
}

/**
 * Note that an agent did this, so the person can see it later and decide
 * whether they want that client to keep acting for them.
 *
 * A failure here is swallowed on purpose. The write it describes has already
 * happened; refusing the response because the note could not be filed would
 * turn a bookkeeping problem into a caller that retries and writes it twice.
 */
export async function recordAgentWrite(
  caller: SupabaseClient,
  entry: {
    action: string;
    groupId?: string | null;
    objectId?: string | null;
    amountMinor?: bigint | null;
    currency?: string | null;
  },
): Promise<void> {
  try {
    await caller.rpc('waves_record_agent_write', {
      p_action: entry.action,
      p_group_id: entry.groupId ?? null,
      p_object_id: entry.objectId ?? null,
      p_amount_minor:
        entry.amountMinor === null || entry.amountMinor === undefined
          ? null
          : entry.amountMinor.toString(),
      p_currency: entry.currency ?? null,
    });
  } catch {
    // Deliberately silent — see above.
  }
}
