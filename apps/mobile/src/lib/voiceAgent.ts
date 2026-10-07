/**
 * The advanced-voice call (Pro): send the live-transcribed sentence to the `voice-agent`
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

import { backend } from '@/lib/backend';
import { resultFromError, type VoiceAgentResult } from '@/lib/voiceAgentPure';

export { resultFromError };
export type { VoiceAgentResult };

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

/** Send what Deepgram heard (streamed live) to the agent. */
export function sendVoiceTranscript(input: {
  transcript: string;
  groupId: string | null;
  locale: string;
  today: string;
  /** This sentence answers the agent's last question. */
  followUp?: { transcript: string; question: string } | null;
}): Promise<VoiceAgentResult> {
  return callVoiceAgent({
    schemaVersion: VOICE_AGENT_SCHEMA_VERSION,
    transcript: input.transcript,
    groupId: input.groupId,
    locale: input.locale,
    today: input.today,
    ...(input.followUp ? { followUp: input.followUp } : {}),
  });
}

/**
 * Count a fast-path command: the sentence was streamed (Deepgram) but read on
 * the phone, so the agent never saw it. The server reserves one command and
 * answers `{actions: [], quota}`, or 402 once the month is spent — which the
 * caller ignores: the review is already on screen, and the next mic start's
 * token answers 402 too and falls back with "Monthly limit reached". On-device
 * (non-streamed) commands are never metered, so nothing else calls this.
 */
export async function meterVoiceCommand(input: {
  transcript: string;
  locale: string;
  today: string;
}): Promise<VoiceAgentResult['kind']> {
  try {
    const { data, error } = await backend.functions.invoke('voice-agent', {
      body: {
        schemaVersion: VOICE_AGENT_SCHEMA_VERSION,
        transcript: input.transcript,
        meterOnly: true,
        locale: input.locale,
        today: input.today,
      } satisfies VoiceAgentRequest,
    });
    if (error) return (await readError(error)).kind;
    return data ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}
