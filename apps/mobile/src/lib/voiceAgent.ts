/**
 * The advanced-voice call (Pro): send the recorded clip to the `voice-agent`
 * edge function and get proposed actions back. Nothing is written here — the
 * screen confirms each action and runs it through the ordinary write paths.
 *
 * Every failure becomes a typed result rather than a throw, because the caller's
 * only decision is "show the cards" or "quietly use the basic on-device path":
 * quota and unavailability fall back with a note, anything else (network, a
 * malformed body) falls back silently.
 */

import {
  VOICE_AGENT_SCHEMA_VERSION,
  type VoiceAgentRequest,
  type VoiceAgentResponse,
} from '@waves/core';
import * as FileSystem from 'expo-file-system';

import { backend } from '@/lib/backend';
import {
  clipMimeType,
  clipTooLong,
  resultFromError,
  type VoiceAgentResult,
  type VoiceClip,
} from '@/lib/voiceAgentPure';

export { clipMimeType, clipTooLong, resultFromError };
export type { VoiceAgentResult, VoiceClip };

async function readError(error: unknown): Promise<VoiceAgentResult> {
  const response = (error as { context?: unknown } | null)?.context;
  if (typeof Response !== 'undefined' && response instanceof Response) {
    let code: string | null = null;
    try {
      const body = (await response.clone().json()) as { code?: unknown };
      code = typeof body.code === 'string' ? body.code : null;
    } catch {
      // Not our JSON — the status alone decides.
    }
    return resultFromError(code, response.status);
  }
  return { kind: 'error' };
}

function isResponse(value: unknown): value is VoiceAgentResponse {
  const candidate = value as Partial<VoiceAgentResponse> | null;
  return (
    !!candidate &&
    typeof candidate.transcript === 'string' &&
    Array.isArray(candidate.actions) &&
    !!candidate.quota &&
    typeof candidate.quota.used === 'number' &&
    typeof candidate.quota.limit === 'number'
  );
}

export async function callVoiceAgent(request: VoiceAgentRequest): Promise<VoiceAgentResult> {
  try {
    const { data, error } = await backend.functions.invoke('voice-agent', { body: request });
    if (error) return await readError(error);
    return isResponse(data) ? { kind: 'ok', response: data } : { kind: 'error' };
  } catch {
    return { kind: 'error' };
  }
}

/** Read the clip and call the agent. A clip that cannot be read is a plain error. */
export async function sendVoiceClip(input: {
  clip: VoiceClip;
  groupId: string | null;
  locale: string;
  today: string;
}): Promise<VoiceAgentResult> {
  if (clipTooLong(input.clip)) return { kind: 'too-long' };
  let audioBase64: string;
  try {
    audioBase64 = await new FileSystem.File(input.clip.uri).base64();
  } catch {
    return { kind: 'error' };
  }
  return callVoiceAgent({
    schemaVersion: VOICE_AGENT_SCHEMA_VERSION,
    audioBase64,
    mimeType: clipMimeType(input.clip.uri),
    durationMs: Math.round(input.clip.durationMs),
    groupId: input.groupId,
    locale: input.locale,
    today: input.today,
  });
}
