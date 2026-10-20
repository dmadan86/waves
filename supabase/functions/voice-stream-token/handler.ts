/**
 * voice-stream-token — RETIRED. Answers 410 to everything.
 *
 * This used to mint a 60-second Deepgram token (`/v1/auth/grant`) and hand the
 * phone the raw Deepgram URL. The token's TTL only gated the socket *open*; a
 * modified client could hold each mint open for as long as it kept sending
 * audio, so one mint bought unbounded Deepgram minutes (abuse audit H1 /
 * WAV-09). The server relay (`voice-stream`) replaced it and enforces the 20 s
 * cap itself; builds from before the relay fall back to on-device listening on
 * any refusal, which is what a 410 is to them.
 *
 * Kept as a handler (not deleted) so the function can stay deployed as a
 * tombstone during the transition, and so nothing can resurrect the mint by
 * accident: there is no Deepgram call left in this file. Remove it from the
 * project with `supabase functions delete voice-stream-token` when the old
 * builds are gone.
 */

import { HttpError, type SupabaseClient } from '../_shared/auth.ts';

export { hashProfile, remainingCommands } from '../_shared/voiceStreamGate.ts';

export const STREAM_TOKEN_TTL_SECONDS = 60;

export interface Deps {
  readonly env: (name: string) => string | undefined;
  readonly caller: SupabaseClient;
  readonly service: SupabaseClient;
  readonly fetch: typeof fetch;
  readonly rateLimit: (profileId: string) => Promise<void>;
}

export const VOICE_STREAM_TOKEN_RETIRED = 'VOICE_STREAM_TOKEN_RETIRED';

export function handleVoiceStreamToken(_request: Request, _deps: Deps): Promise<Response> {
  // Before auth, before the rate limit, before any read: nothing about the
  // caller is consulted and nothing is spent or minted.
  return Promise.reject(
    new HttpError(
      410,
      VOICE_STREAM_TOKEN_RETIRED,
      'Live transcription moved to the voice-stream relay; update the app',
    ),
  );
}
