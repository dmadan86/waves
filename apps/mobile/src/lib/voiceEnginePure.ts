/**
 * Which engine hears the mic, and why — pure, so the rules are tested apart from
 * the screen. The cloud engine is the live Deepgram stream (advanced voice); the
 * on-device one is the phone's own recogniser. A fallback to on-device always
 * carries a reason the badge can name.
 */

export type VoiceEngine = 'cloud' | 'on-device';
export type VoiceEngineReason = 'free' | 'quota' | 'offline';

export interface VoiceEngineInfo {
  engine: VoiceEngine;
  reason: VoiceEngineReason | null;
}

/** A streamed sentence ends this long after the last word... */
export const STREAM_SILENCE_MS = 2200;
/** ...or, if nothing is said at all, after this long. */
export const STREAM_FIRST_WORD_MS = 8000;

export const CLOUD: VoiceEngineInfo = { engine: 'cloud', reason: null };
export const local = (reason: VoiceEngineReason | null): VoiceEngineInfo => ({
  engine: 'on-device',
  reason,
});

/** The shape of expo-network's state that matters here. */
export interface NetworkSnapshot {
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
}

/** Offline only when the platform says so; an unknown reading counts as online. */
export function isOnline(state: NetworkSnapshot | null | undefined): boolean {
  if (!state) return true;
  if (state.isConnected === false) return false;
  return state.isInternetReachable !== false;
}

export interface EngineInputs {
  /** The user has advanced voice (flag / tier). */
  enabled: boolean;
  online: boolean;
  /** The agent said the monthly allowance is spent. */
  quotaReached?: boolean;
  /** Did the live stream open? null: not tried yet. */
  streamOk?: boolean | null;
  /** This build can stream at all (native module present). */
  streamAvailable?: boolean;
}

/** The engine in use, and the reason when it is the on-device one. */
export function resolveEngine(input: EngineInputs): VoiceEngineInfo {
  if (!input.enabled) return local('free');
  if (input.quotaReached) return local('quota');
  if (!input.online) return local('offline');
  if (input.streamOk === false) {
    // A build without the native stream is not "offline"; say nothing extra.
    return local(input.streamAvailable === false ? null : 'offline');
  }
  return CLOUD;
}

export interface MicStartInputs {
  enabled: boolean;
  online: boolean;
  /** A finger is on the bar's mic (push-to-talk) as the mic opens. */
  held: boolean;
  streamAvailable?: boolean;
}

export interface MicStartPlan {
  /** Try the live stream. Identical for a tap and a hold: how it was started never picks the engine. */
  stream: boolean;
  /** Why it will not stream (the badge's reason). */
  fallback: VoiceEngineInfo | null;
  /** When the sentence ends by itself. A hold ends on release, so it has no timers. */
  silenceMs: number | null;
  firstWordMs: number | null;
}

export function planMicStart(input: MicStartInputs): MicStartPlan {
  const info = resolveEngine({
    enabled: input.enabled,
    online: input.online,
    streamAvailable: input.streamAvailable,
    streamOk: input.streamAvailable === false ? false : null,
  });
  return {
    stream: info.engine === 'cloud',
    fallback: info.engine === 'cloud' ? null : info,
    silenceMs: input.held ? null : STREAM_SILENCE_MS,
    firstWordMs: input.held ? null : STREAM_FIRST_WORD_MS,
  };
}
