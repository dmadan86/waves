/**
 * What the phone does with a voice clip the watch recorded — the pure half.
 *
 * Decoding the file event, and turning a transcript (free path) or the
 * `voice-agent` response (Pro path) into captures plus the one line the watch
 * shows. Nothing here touches the microphone, the network or the ledger; the
 * bridge does the I/O and feeds the results in.
 *
 * The safety is the existing `voiceAdd` path's: money only ever lands as
 * unassigned captures the person files on the phone, and a sentence that names
 * someone else as the payer is refused, because a capture cannot hold who paid.
 */

import {
  format as formatMoney,
  money as toMoney,
  parseWatchToPhone,
  type VoiceAgentResponse,
  type WatchVoiceStatus,
} from '@waves/core';

import { parseVoiceExpenses, type VoiceGroupRef } from '@/lib/voiceExpense';

export interface WatchClip {
  id: string;
  durationMs: number;
  uri: string;
}

/** Decode a `onWatchFile` event. Null for anything that is not a well-formed clip. */
export function parseWatchClip(event: unknown): WatchClip | null {
  if (typeof event !== 'object' || event === null) return null;
  const { uri, metadata } = event as { uri?: unknown; metadata?: unknown };
  if (typeof uri !== 'string' || uri.length === 0) return null;
  const msg = parseWatchToPhone(metadata);
  if (!msg || msg.t !== 'voiceClip') return null;
  return { id: msg.id, durationMs: msg.durationMs, uri };
}

export interface ClipCapture {
  amountMinor: bigint;
  currency: string;
  note: string;
}

export interface ClipOutcome {
  captures: ClipCapture[];
  /** The text the captures were made from, kept as the capture's raw text. */
  rawText: string;
  result: { status: WatchVoiceStatus; text: string; error?: string };
}

export interface ClipContext {
  groups: readonly VoiceGroupRef[];
  defaultCurrency: string;
  locale: string;
}

const failure = (error: string, rawText = ''): ClipOutcome => ({
  captures: [],
  rawText,
  result: { status: 'error', text: '', error },
});

/** "₹8,000 · Renny" — or "2 expenses · ₹1,300" when several were heard. */
export function describeCaptures(captures: readonly ClipCapture[], locale: string): string {
  const fmt = (c: ClipCapture): string => {
    try {
      return formatMoney(toMoney(c.amountMinor, c.currency), { locale });
    } catch {
      return `${c.amountMinor.toString()} ${c.currency}`;
    }
  };
  if (captures.length === 1) {
    const only = captures[0] as ClipCapture;
    return only.note ? `${fmt(only)} · ${only.note}` : fmt(only);
  }
  return captures.map(fmt).join(' + ');
}

/** Captures from a transcript, by the same parser and guards as `voiceAdd`. */
function capturesFromTranscript(
  transcript: string,
  ctx: ClipContext,
): { captures: ClipCapture[]; error?: string } {
  const result = parseVoiceExpenses(transcript, ctx.groups);
  if (result.intent?.payer.explicit && result.intent.payer.kind === 'member') {
    return { captures: [], error: 'payer' };
  }
  const captures = result.items
    .filter((item) => item.amountMinor > 0n)
    .map((item) => ({
      amountMinor: item.amountMinor,
      currency: item.currency ?? ctx.defaultCurrency,
      note: item.note,
    }));
  return captures.length === 0 ? { captures, error: 'no-amount' } : { captures };
}

/** The free path: a transcript from on-device recognition. */
export function outcomeFromTranscript(transcript: string, ctx: ClipContext): ClipOutcome {
  const text = transcript.trim();
  if (text.length === 0) return failure('nothing-heard');
  const { captures, error } = capturesFromTranscript(text, ctx);
  if (captures.length === 0) return failure(error ?? 'no-amount', text);
  return {
    captures,
    rawText: text,
    result: { status: 'added', text: describeCaptures(captures, ctx.locale) },
  };
}

/**
 * The Pro path: what `voice-agent` proposed for the clip.
 *
 * Only a personal spend is taken from the agent's own fields. Anything it
 * proposes beyond that — a group expense, a split, a settlement, a new group —
 * needs a confirmation the wrist cannot give, so the money in the sentence is
 * saved the same safe way as a free-path clip (unassigned, via the transcript)
 * and reported as `review`; the non-expense actions are not run at all.
 */
export function outcomeFromAgent(response: VoiceAgentResponse, ctx: ClipContext): ClipOutcome {
  const transcript = response.transcript.trim();
  const captures: ClipCapture[] = [];
  let beyondPersonal = false;

  for (const action of response.actions) {
    if (action.type === 'add_personal' && /^\d+$/.test(action.amountMinor)) {
      const amountMinor = BigInt(action.amountMinor);
      if (amountMinor > 0n) {
        captures.push({
          amountMinor,
          currency: action.currency,
          note: action.description.trim(),
        });
        continue;
      }
    }
    beyondPersonal = true;
  }

  if (beyondPersonal || captures.length === 0) {
    const fallback = capturesFromTranscript(transcript, ctx);
    if (fallback.error === 'payer') return failure('payer', transcript);
    // Agent-proposed personal captures win; the transcript fills in otherwise.
    if (captures.length === 0) captures.push(...fallback.captures);
  }

  if (captures.length === 0) {
    // Nothing to save: if the agent asked something, that is the useful answer.
    const ask = response.clarify?.trim() || response.answer?.trim();
    return {
      captures: [],
      rawText: transcript,
      result: { status: 'error', text: ask ?? '', error: ask ? 'clarify' : 'no-amount' },
    };
  }
  return {
    captures,
    rawText: transcript,
    result: {
      status: beyondPersonal ? 'review' : 'added',
      text: describeCaptures(captures, ctx.locale),
    },
  };
}

export interface ClipDeps {
  /** Pro advanced voice is on for this person (server-checked). */
  agentEnabled: boolean;
  ctx: ClipContext;
  /** Base64 of the clip, for the agent. Throws when the file is unreadable. */
  readBase64: (uri: string) => Promise<string>;
  /** The `voice-agent` call, audio mode. */
  callAgent: (clip: {
    audioBase64: string;
    durationMs: number;
  }) => Promise<
    { kind: 'ok'; response: VoiceAgentResponse } | { kind: 'quota' | 'unavailable' | 'error' }
  >;
  /** On-device file transcription; null when it could not run or heard nothing. */
  transcribe: (uri: string) => Promise<string | null>;
}

/**
 * Turn one clip into an outcome.
 *
 * Pro people get the agent first; a quota, an outage or any failure there falls
 * through to on-device transcription of the same file, so a clip is only lost
 * when both fail.
 */
export async function processClip(clip: WatchClip, deps: ClipDeps): Promise<ClipOutcome> {
  if (deps.agentEnabled) {
    try {
      const audioBase64 = await deps.readBase64(clip.uri);
      const called = await deps.callAgent({ audioBase64, durationMs: clip.durationMs });
      if (called.kind === 'ok') return outcomeFromAgent(called.response, deps.ctx);
    } catch {
      // Unreadable file or a thrown call — try the free path below.
    }
  }
  let transcript: string | null = null;
  try {
    transcript = await deps.transcribe(clip.uri);
  } catch {
    transcript = null;
  }
  if (transcript === null) return clipFailure('failed');
  return outcomeFromTranscript(transcript, deps.ctx);
}

export const clipFailure = failure;
