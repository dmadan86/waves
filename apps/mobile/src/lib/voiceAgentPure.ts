/** The pure half of the voice-agent call: result types and error mapping. */

import { VOICE_AGENT_MAX_CLIP_MS, VoiceAgentError, type VoiceAgentResponse } from '@waves/core';

export type VoiceAgentResult =
  | { kind: 'ok'; response: VoiceAgentResponse }
  | { kind: 'quota' }
  | { kind: 'unavailable' }
  | { kind: 'too-long' }
  | { kind: 'nothing-heard' }
  | { kind: 'error' };

/** A recorded clip the on-device recogniser persisted (see VoiceCapture). */
export interface VoiceClip {
  uri: string;
  durationMs: number;
}

export function clipMimeType(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.caf')) return 'audio/x-caf';
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  return 'audio/wav';
}

/** Longer than the function accepts — not worth uploading. */
export function clipTooLong(clip: VoiceClip): boolean {
  return clip.durationMs > VOICE_AGENT_MAX_CLIP_MS;
}

/** Map an error code (body `code`, else HTTP status) onto a typed result. */
export function resultFromError(code: string | null, status: number | null): VoiceAgentResult {
  if (code === VoiceAgentError.QuotaReached || status === 402) return { kind: 'quota' };
  if (code === VoiceAgentError.Unavailable || status === 503) return { kind: 'unavailable' };
  if (code === VoiceAgentError.ClipTooLong || status === 413) return { kind: 'too-long' };
  if (code === VoiceAgentError.NothingHeard || status === 422) return { kind: 'nothing-heard' };
  return { kind: 'error' };
}
