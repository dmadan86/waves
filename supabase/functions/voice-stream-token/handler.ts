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
 * Gated like voice-agent (flag/allowlist, rate limit, monthly stream budget):
 * the gate is `_shared/voiceStreamGate.ts`, shared with the relay.
 *
 * SUPERSEDED by `voice-stream` (the server relay, which enforces the 20 s cap
 * server-side; a token handed to the phone cannot be capped, see
 * docs/voice-cloud-stt-and-structuring.md §10.1). Kept deployed, unused by
 * current builds, so app builds from before the relay keep streaming. Remove it
 * once those builds are gone.
 */

import { HttpError, json, type SupabaseClient } from '../_shared/auth.ts';
import {
  VoiceAgentError,
  type VoiceStreamTokenRequest,
  type VoiceStreamTokenResponse,
} from '../_shared/core.js';
import { admitStream } from '../_shared/voiceStreamGate.ts';
import { loadContext } from '../voice-agent/handler.ts';
import { deepgramStreamUrl, keyterms } from '../voice-agent/logic.ts';

export { hashProfile, remainingCommands } from '../_shared/voiceStreamGate.ts';

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

  const { profileId, profileHash, key } = await admitStream(deps, 'voice-stream-token');
  const unavailable = (message: string) => new HttpError(503, VoiceAgentError.Unavailable, message);

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
