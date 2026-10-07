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
 * command.
 */

import { HttpError, json, type SupabaseClient } from '../_shared/auth.ts';
import {
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

  const context = await loadContext(deps.caller, profileId, {
    schemaVersion: 1,
    locale,
    today: new Date().toISOString().slice(0, 10),
    groupId,
  });

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

  const body: VoiceStreamTokenResponse = {
    token: minted.access_token,
    url: deepgramStreamUrl(locale, keyterms(context)),
    expiresInSeconds: minted.expires_in ?? STREAM_TOKEN_TTL_SECONDS,
    sampleRate: 16000,
    encoding: 'linear16',
  };
  return json(body);
}
