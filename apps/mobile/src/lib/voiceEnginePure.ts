/**
 * Which engine hears the mic, and why — pure, so the rules are tested apart from
 * the screen. The cloud engine is the live Deepgram stream (advanced voice); the
 * on-device one is the phone's own recogniser. A fallback to on-device always
 * carries a reason the badge can name.
 */

export type VoiceEngine = 'cloud' | 'on-device';
/**
 * Why the phone's own recogniser/parser is in use. `cloud-down`: the phone is
 * online but the cloud side (relay, Deepgram, the agent or its models) failed
 * or timed out — distinct from `offline`, which only the phone's own network
 * state may claim.
 */
export type VoiceEngineReason = 'free' | 'quota' | 'offline' | 'cloud-down';

export interface VoiceEngineInfo {
  engine: VoiceEngine;
  reason: VoiceEngineReason | null;
}

/** A streamed sentence ends this long after the last word... */
export const STREAM_SILENCE_MS = 2200;
/** ...or, if nothing is said at all, after this long. */
export const STREAM_FIRST_WORD_MS = 5000;
/** No voice session runs longer than this, however it was started. */
export const STREAM_MAX_SESSION_MS = 20_000;

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
    // Online but the stream would not open: the cloud is what failed.
    return local(input.streamAvailable === false ? null : 'cloud-down');
  }
  return CLOUD;
}

/**
 * How long the app waits for the agent (voice-agent) before it reads the
 * sentence it already has on the phone. The server answers — success or a
 * refunded 503 — within 9 s, so this only fires when the network or the
 * function itself is stuck.
 */
export const AGENT_CALL_TIMEOUT_MS = 10_000;

/** Why the agent call did not give the screen an answer. */
export type AgentFailure = 'quota' | 'timeout' | 'unavailable' | 'error';

/**
 * The badge after the agent call failed and the basic parser took the
 * transcript: the monthly limit, else offline when the phone says so, else the
 * cloud was unavailable (a 503, a timeout, a bad reply).
 */
export function engineAfterAgentFailure(failure: AgentFailure, online: boolean): VoiceEngineInfo {
  if (failure === 'quota') return local('quota');
  if (!online) return local('offline');
  return local('cloud-down');
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
  /**
   * When the sentence ends by itself. Every session has them — a hold that was
   * misread (a tap the gesture took for a hold) must not leave the mic open
   * with nothing to end it. A real hold gets a longer pause allowance, since
   * the finger lifting is its usual end.
   */
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
    silenceMs: input.held ? STREAM_SILENCE_MS * 2 : STREAM_SILENCE_MS,
    firstWordMs: STREAM_FIRST_WORD_MS,
  };
}
