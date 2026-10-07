/**
 * voice-stream-token — the key to the app's live transcription stream.
 *
 * The advanced voice streams the mic straight to Deepgram while the person
 * speaks (live captions, no upload wait), the way production voice apps do. The
 * Deepgram key never ships in the app: this mints a 60-second token (Deepgram
 * `/v1/auth/grant`) — it only has to be valid when the socket opens — and hands
 * back the exact streaming URL, with the caller's group and member names as
 * keyterms so they come back spelled right.
 *
 * Gated like voice-agent (flag/allowlist, rate limit). Quota is spent later, on
 * the text call to voice-agent, so opening the mic and saying nothing costs no
 * command. It does cost Deepgram minutes, so every mint is also counted against
 * a separate monthly stream budget (`waves_voice_stream_mint`, 3x the command
 * allowance) and logged with a hashed profile id, so the spend can be measured.
 */

import { HttpError, json, type SupabaseClient } from '../_shared/auth.ts';
import {
  VOICE_AGENT_FREE_MONTHLY,
  VOICE_AGENT_PRO_MONTHLY,
  VOICE_STREAM_FREE_MONTHLY,
  VOICE_STREAM_PRO_MONTHLY,
  VoiceAgentError,
  type VoiceStreamTokenRequest,
  type VoiceStreamTokenResponse,
} from '../_shared/core.js';
import { loadContext } from '../voice-agent/handler.ts';
import { deepgramStreamUrl, keyterms } from '../voice-agent/logic.ts';

export const STREAM_TOKEN_TTL_SECONDS = 60;

export interface Deps {
  readonly env: (name: string) => string | undefined;
  readonly caller: SupabaseClient;
  readonly service: SupabaseClient;
  readonly fetch: typeof fetch;
  readonly rateLimit: (profileId: string) => Promise<void>;
}

export async function handleVoiceStreamToken(request: Request, deps: Deps): Promise<Response> {
  if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Use POST');
  const raw = (await request.json().catch(() => null)) as Partial<VoiceStreamTokenRequest> | null;
  const locale = typeof raw?.locale === 'string' ? raw.locale : 'en';
  const groupId = typeof raw?.groupId === 'string' ? raw.groupId : null;

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

  // The stream budget: a reservation, taken before the mint so a mic opened and
  // abandoned over and over runs out too. Fails closed — this is a spend gate,
  // and the app falls back to on-device listening on any refusal.
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
      fn: 'voice-stream-token',
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

  // The caller's names (for keyterms) and the minted token, together.
  const contextLoad = loadContext(deps.caller, profileId, {
    schemaVersion: 1,
    locale,
    today: new Date().toISOString().slice(0, 10),
    groupId,
  });
  contextLoad.catch(() => undefined);

  const grant = await deps.fetch('https://api.deepgram.com/v1/auth/grant', {
    method: 'POST',
    headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl_seconds: STREAM_TOKEN_TTL_SECONDS }),
  });
  if (!grant.ok) {
    // 403 here means the key cannot mint tokens (a Member-role key): the app
    // falls back to on-device, so say "unavailable" rather than fail loudly.
    console.error('deepgram grant error', grant.status);
    throw unavailable('Live transcription is not available');
  }
  const minted = (await grant.json()) as { access_token?: string; expires_in?: number };
  if (!minted.access_token) throw unavailable('Live transcription is not available');

  const context = await contextLoad;
  const body: VoiceStreamTokenResponse = {
    token: minted.access_token,
    // Tagged with the hashed profile so Deepgram's usage API can reconcile the
    // real streamed minutes against the mint log.
    url: deepgramStreamUrl(locale, keyterms(context), `vst-${profileHash}`),
    expiresInSeconds: minted.expires_in ?? STREAM_TOKEN_TTL_SECONDS,
    sampleRate: 16000,
    encoding: 'linear16',
  };
  return json(body);
}

interface StreamMint {
  readonly allowed: boolean;
  readonly mints: number;
  readonly budget: number;
  readonly tier: 'free' | 'plus' | 'pro';
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
