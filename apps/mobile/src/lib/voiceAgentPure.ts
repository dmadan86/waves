/** The pure half of the voice-agent call: result types and error mapping. */

import { VoiceAgentError, type VoiceAgentResponse } from '@waves/core';

export type VoiceAgentResult =
  | { kind: 'ok'; response: VoiceAgentResponse }
  | { kind: 'quota' }
  | { kind: 'unavailable' }
  | { kind: 'too-long' }
  | { kind: 'nothing-heard' }
  | { kind: 'error' };

/** Map an error code (body `code`, else HTTP status) onto a typed result. */
export function resultFromError(code: string | null, status: number | null): VoiceAgentResult {
  if (code === VoiceAgentError.QuotaReached || status === 402) return { kind: 'quota' };
  if (code === VoiceAgentError.Unavailable || status === 503) return { kind: 'unavailable' };
  if (code === VoiceAgentError.ClipTooLong || status === 413) return { kind: 'too-long' };
  if (code === VoiceAgentError.NothingHeard || status === 422) return { kind: 'nothing-heard' };
  return { kind: 'error' };
}
