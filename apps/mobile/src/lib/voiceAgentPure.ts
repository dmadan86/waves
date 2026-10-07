/** The pure half of the voice-agent call: result types and error mapping. */

import { VoiceAgentError, type VoiceAgentResponse } from '@waves/core';

import type { AgentFailure } from '@/lib/voiceEnginePure';

export type VoiceAgentResult =
  | { kind: 'ok'; response: VoiceAgentResponse }
  | { kind: 'quota' }
  | { kind: 'unavailable' }
  | { kind: 'too-long' }
  | { kind: 'nothing-heard' }
  | { kind: 'timeout' }
  | { kind: 'error' };

/** Map an error code (body `code`, else HTTP status) onto a typed result. */
export function resultFromError(code: string | null, status: number | null): VoiceAgentResult {
  if (code === VoiceAgentError.QuotaReached || status === 402) return { kind: 'quota' };
  if (code === VoiceAgentError.Unavailable || status === 503) return { kind: 'unavailable' };
  if (code === VoiceAgentError.ClipTooLong || status === 413) return { kind: 'too-long' };
  if (code === VoiceAgentError.NothingHeard || status === 422) return { kind: 'nothing-heard' };
  return { kind: 'error' };
}

/**
 * `work`, or `onTimeout()` once `ms` has passed — whichever is first. `abort`
 * runs on the timeout so the request itself is dropped too. Never rejects when
 * `work` never rejects; the timer is always cleared.
 */
export function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  onTimeout: () => T,
  abort?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      abort?.();
      resolve(onTimeout());
    }, ms);
    work.then(
      (value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Why a non-ok result fell back, for the badge (engineAfterAgentFailure). */
export function agentFailureOf(result: Exclude<VoiceAgentResult, { kind: 'ok' }>): AgentFailure {
  switch (result.kind) {
    case 'quota':
      return 'quota';
    case 'timeout':
      return 'timeout';
    case 'unavailable':
      return 'unavailable';
    default:
      return 'error';
  }
}
