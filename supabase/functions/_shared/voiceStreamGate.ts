/**
 * The gate in front of every live Deepgram stream, shared by `voice-stream` (the
 * relay the app uses) and `voice-stream-token` (the token mint older builds
 * still call). In order: signed in, flag/allowlist, the key is configured, the
 * rate limit, a peek at this month's command allowance, then one stream mint
 * taken from the monthly stream budget (`waves_voice_stream_mint`). Every
 * refusal is an HttpError the caller turns into its own wire format.
 */

import { HttpError, type SupabaseClient } from './auth.ts';
import {
  VOICE_AGENT_FREE_MONTHLY,
  VOICE_AGENT_PRO_MONTHLY,
  VOICE_STREAM_FREE_MONTHLY,
  VOICE_STREAM_PRO_MONTHLY,
  VoiceAgentError,
} from './core.js';

export interface StreamGateDeps {
  readonly env: (name: string) => string | undefined;
  readonly caller: SupabaseClient;
  readonly service: SupabaseClient;
  readonly rateLimit: (profileId: string) => Promise<void>;
}

/** A caller let through: who they are (and their hash), the key, the mint taken. */
export interface Admitted {
  readonly profileId: string;
  readonly profileHash: string;
  readonly key: string;
  readonly tier: StreamMint['tier'];
  readonly mints: number;
  readonly budget: number;
}

interface StreamMint {
  readonly allowed: boolean;
  readonly mints: number;
  readonly budget: number;
  readonly tier: 'free' | 'plus' | 'pro';
}

export async function admitStream(deps: StreamGateDeps, fn: string): Promise<Admitted> {
  const { data: userData, error: userError } = await deps.caller.auth.getUser();
  if (userError || !userData?.user) throw new HttpError(401, 'NOT_AUTHENTICATED', 'Sign in first');
  const profileId = userData.user.id as string;

  const unavailable = (message: string) => new HttpError(503, VoiceAgentError.Unavailable, message);
  const { data: enabled, error: flagError } = await deps.service.rpc('waves_voice_agent_enabled', {
    p_profile: profileId,
  });
  if (flagError || enabled !== true) throw unavailable('Advanced voice is not available');

  const key = deps.env('DEEPGRAM_API_KEY');
  if (!key) throw unavailable('Advanced voice is not configured');
  await deps.rateLimit(profileId);

  // No live stream once this month's allowance is spent: the stream is a cost
  // too (Deepgram bills the minutes), not only the model call. The app hears a
  // 402 and listens on the phone instead. A peek, not a reservation — the
  // command is counted when the words are used (voice-agent, or its meter call
  // for the instant on-phone path).
  const remaining = await remainingCommands(deps.service, profileId, new Date());
  if (remaining <= 0) {
    throw new HttpError(402, VoiceAgentError.QuotaReached, 'Advanced voice allowance used up');
  }

  // The stream budget: a reservation, taken before the stream so a mic opened
  // and abandoned over and over runs out too. Fails closed — this is a spend
  // gate, and the app falls back to on-device listening on any refusal.
  const { data: mintData, error: mintError } = await deps.service.rpc('waves_voice_stream_mint', {
    p_profile: profileId,
    p_free_budget: VOICE_STREAM_FREE_MONTHLY,
    p_pro_budget: VOICE_STREAM_PRO_MONTHLY,
  });
  const mint = mintData as StreamMint | null;
  if (mintError || !mint) {
    console.error('stream budget check failed', mintError?.message);
    throw unavailable('Live transcription is not available');
  }
  const profileHash = await hashProfile(profileId);
  // Cost measurement: one line per mint, no names, no transcripts.
  console.log(
    JSON.stringify({
      fn,
      event: mint.allowed ? 'mint' : 'mint_refused',
      profile: profileHash,
      tier: mint.tier,
      mintsThisMonth: mint.mints,
      budget: mint.budget,
    }),
  );
  if (!mint.allowed) {
    throw new HttpError(402, VoiceAgentError.StreamBudget, 'Live transcription budget used up');
  }
  return { profileId, profileHash, key, tier: mint.tier, mints: mint.mints, budget: mint.budget };
}

/** First 12 hex of SHA-256(profile id): stable per person, not reversible to it. */
export async function hashProfile(profileId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(profileId));
  return Array.from(new Uint8Array(digest).slice(0, 6), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

/**
 * Commands left this calendar month (UTC), read the way waves_voice_agent_quota
 * counts them: an active, unexpired 'pro' subscription gets the Pro allowance,
 * everyone else the free one.
 */
export async function remainingCommands(
  service: SupabaseClient,
  profileId: string,
  now: Date,
): Promise<number> {
  const month = now.toISOString().slice(0, 7);
  const [subs, usage] = await Promise.all([
    service
      .from('subscriptions')
      .select('tier, status, current_period_end')
      .eq('profile_id', profileId)
      .eq('status', 'active'),
    service
      .from('voice_agent_usage')
      .select('count')
      .eq('profile_id', profileId)
      .eq('month', month)
      .maybeSingle(),
  ]);
  const rows = (subs.data ?? []) as { tier: string; current_period_end: string | null }[];
  const pro = rows.some(
    (row) =>
      row.tier === 'pro' &&
      (row.current_period_end === null || new Date(row.current_period_end) > now),
  );
  const limit = pro ? VOICE_AGENT_PRO_MONTHLY : VOICE_AGENT_FREE_MONTHLY;
  const used = Number((usage.data as { count?: number } | null)?.count ?? 0);
  return limit - used;
}
