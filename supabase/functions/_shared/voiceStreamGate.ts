/**
 * The gate in front of every live Deepgram stream, shared by `voice-stream` (the
 * relay the app uses) and `voice-stream-token` (the token mint older builds
 * still call). In order: signed in, flag/allowlist, the key is configured, the
 * rate limit, a peek at this month's command allowance, then one stream mint
 * taken from the monthly stream budget (`waves_voice_stream_mint`), which also
 * refuses Free (outside the Pro trial) with a 403. Every
 * refusal is an HttpError the caller turns into its own wire format.
 */

import { HttpError, type SupabaseClient } from './auth.ts';
import {
  VOICE_AGENT_FREE_MONTHLY,
  VOICE_AGENT_PRO_MONTHLY,
  PRO_TRIAL_VOICE_DAYS,
  VOICE_AGENT_TRIAL_COMMANDS,
  VOICE_STREAM_FREE_MONTHLY,
  VOICE_STREAM_PRO_MONTHLY,
  VOICE_STREAM_TRIAL_MONTHLY,
  VoiceAgentError,
} from './core.js';

/**
 * Seconds of audio one mint may carry (the relay's cap). The seconds budget
 * handed to `waves_voice_stream_mint` is this times the mint budget: the
 * measured minutes Deepgram bills are bounded by the server even if every
 * stream ran to its cap.
 */
export const STREAM_SECONDS_PER_MINT = 20;

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
  /** 'free_tier': Free is never streamed (Deepgram is for Pro and the trial). */
  readonly reason?: string;
  readonly mints: number;
  readonly budget: number;
  readonly tier: 'free' | 'pro';
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
    p_trial_budget: VOICE_STREAM_TRIAL_MONTHLY,
    p_seconds_budget: VOICE_STREAM_PRO_MONTHLY * STREAM_SECONDS_PER_MINT,
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
  if (!mint.allowed && mint.reason === 'free_tier') {
    // Free's commands use the phone's own speech recogniser and reach voice-agent
    // as text (about a seventh of the cost). The app asks for a stream only when
    // it thinks the person is not Free; this is the server's own answer.
    throw new HttpError(
      403,
      VoiceAgentError.StreamFreeTier,
      'Live transcription is not on this plan',
    );
  }
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
 * Commands left, read the way waves_voice_agent_quota counts them: on the Pro
 * trial (a live 'trial' row and no purchased plan or other Pro) it is the
 * trial's 20 in total less pro_trials.voice_used; otherwise this calendar month
 * (UTC): an active, unexpired 'pro' (or legacy 'plus', which is Pro) subscription
 * gets the Pro allowance, everyone else the free one.
 */
export async function remainingCommands(
  service: SupabaseClient,
  profileId: string,
  now: Date,
): Promise<number> {
  const month = now.toISOString().slice(0, 7);
  const [subs, usage, trialRow] = await Promise.all([
    service
      .from('subscriptions')
      .select('tier, status, current_period_end, store')
      .eq('profile_id', profileId)
      .eq('status', 'active'),
    service
      .from('voice_agent_usage')
      .select('count')
      .eq('profile_id', profileId)
      .eq('month', month)
      .maybeSingle(),
    service
      .from('pro_trials')
      .select('voice_used, granted_at, outcome')
      .eq('profile_id', profileId)
      .maybeSingle(),
  ]);
  const rows = (subs.data ?? []) as {
    tier: string;
    store?: string;
    current_period_end: string | null;
  }[];
  const live = (row: { current_period_end: string | null }) =>
    row.current_period_end === null || new Date(row.current_period_end) > now;
  const trialLive = rows.some((row) => row.store === 'trial' && row.tier === 'pro' && live(row));
  const purchasedOrPro = rows.some(
    (row) =>
      row.store !== 'trial' &&
      live(row) &&
      (row.tier === 'pro' || ['play', 'appstore', 'test'].includes(row.store ?? '')),
  );
  // The trial's pool: 20 commands for 30 days from the grant, for anyone with
  // no paid plan of their own (also after the 15 Pro days end). Spent, or past
  // day 30, it is out of the picture and the normal rules apply.
  const pool = trialRow.data as {
    voice_used?: number;
    granted_at?: string;
    outcome?: string;
  } | null;
  const poolOpen =
    !!pool &&
    pool.outcome !== 'skipped_has_plan' &&
    !!pool.granted_at &&
    now.getTime() < new Date(pool.granted_at).getTime() + PRO_TRIAL_VOICE_DAYS * 86_400_000;
  const ownPlan = rows.some(
    (row) => row.store !== 'trial' && live(row) && ['plus', 'pro'].includes(row.tier),
  );
  if (poolOpen && ((trialLive && !purchasedOrPro) || !ownPlan)) {
    return VOICE_AGENT_TRIAL_COMMANDS - Number(pool?.voice_used ?? 0);
  }
  const limit = ownPlan ? VOICE_AGENT_PRO_MONTHLY : VOICE_AGENT_FREE_MONTHLY;
  const used = Number((usage.data as { count?: number } | null)?.count ?? 0);
  return limit - used;
}
