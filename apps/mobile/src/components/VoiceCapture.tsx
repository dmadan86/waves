/**
 * The microphone for the voice quick-add — one spoken sentence, handed back whole.
 *
 * Like `DictateVoice`, recognition is the platform's own and on-device where the
 * phone can manage it, so "add five hundred to the Goa trip" is turned into text
 * on the device, not shipped to a server. It differs in what it is for: not
 * adding to a note, but capturing a single utterance and returning it, so the
 * screen can parse it into an expense.
 *
 * **Nothing imports this file directly** — it is reached through
 * `VoiceMicPanel` inside a `try`, because the `expo-speech-recognition` import
 * throws on any binary built before the native module existed. See the note
 * there.
 */

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { Linking, Pressable, View } from 'react-native';
import { useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { dictationError, englishSpeechLocale, isPermissionError } from '@/lib/dictation';
import { speechMic } from '@/lib/speechMic';
import {
  checkOnline,
  getStreamSession,
  attachStream,
  startCapture,
  streamingAvailable,
  type LiveTranscription,
  type MicCapture,
} from '@/lib/voiceStream';
import { remainingFrom } from '@/lib/voiceStreamPure';
import { pushToTalk } from '@/lib/pushToTalk';

import {
  CLOUD,
  pauseAllowanceMs,
  planMicStart,
  resolveEngine,
  STREAM_MAX_SESSION_MS,
  type MicStartPlan,
  type VoiceCloudConsent,
  type VoiceEngineInfo,
} from '@/lib/voiceEnginePure';
import { createModelProbe, planAgentWait } from '@/lib/voiceStartPure';
import { VoiceErrorState } from '@/components/voice/VoiceErrorState';
import type { MicMode } from '@/components/voice/FloatingMicrophone';
import { VoiceSheetBody } from '@/components/voice/VoiceStage';
import {
  useVoiceSuggestions,
  VoiceSuggestions,
  type Suggestion,
} from '@/components/voice/VoiceSuggestions';
import {
  captureReducer,
  initialCapture,
  micButtonMode,
  showSuggestions,
  voiceFlowState,
  voiceStatusKey,
  type VoiceStatusKey,
} from '@/lib/voiceFlowPure';

/**
 * The least a session timer is given once the stream attaches, however long the
 * token took: the buffered audio still has to reach Deepgram and come back.
 */
const ATTACH_FLOOR_MS = 1500;

/** How long Stop waits for the cloud's last words before ending without them. */
const STOP_GRACE_MS = 2000;

/**
 * Hypotheses to ask the recogniser for. iOS hands back its `transcriptions`;
 * Android its RESULTS_RECOGNITION list (EXTRA_MAX_RESULTS), which on-device
 * engines fill on Android 14+ and many network engines always did.
 */
const MAX_ALTERNATIVES = 5;

// Hand the shared arbiter the real recogniser. Safe at module scope: this file
// is only ever loaded through `VoiceMicPanel`'s guarded require, so reaching it
// at all means the native module imported cleanly.
speechMic.attach({
  stop: () => ExpoSpeechRecognitionModule.stop(),
  abort: () => ExpoSpeechRecognitionModule.abort(),
});

// An app-wide ear for `end`, so a session aborted by a screen that has since
// unmounted is settled the moment its teardown lands rather than after the
// arbiter's 1.5 s guard — which is what a quick close-and-reopen used to wait
// out. Never acts on a session somebody owns (see `SpeechMic.orphanEnded`).
try {
  ExpoSpeechRecognitionModule.addListener('end', () => speechMic.orphanEnded());
} catch {
  // No event emitter on this build: the guard timer still settles it.
}

/**
 * Dev-only timing for the start sequence, so the next "it feels slow" can be
 * measured rather than guessed: one line per step, milliseconds since the tap.
 * Compiled to nothing that logs in a release build.
 */
function startTimer(): (step: string) => void {
  if (!__DEV__) return () => {};
  const t0 = performance.now();
  return (step) => {
    console.log(`[voice-start] ${step} +${Math.round(performance.now() - t0)}ms`);
  };
}

/**
 * How long a session may stay completely inert before it is written off.
 *
 * A live recogniser says so within a beat — `start` (ready for speech) lands
 * well under a second, and `volumechange` follows it continuously. A session
 * that has produced *nothing at all* after this long is not listening: its
 * recogniser was destroyed under it, which the platform reports by saying
 * nothing whatsoever. Generous on purpose, because the only cost of waiting is
 * a slower error and the cost of firing early is cutting somebody off.
 */
const STALL_MS = 8000;

/**
 * The hard cap on one listening session, armed the moment the recogniser is
 * opened and — unlike {@link STALL_MS} — never cleared by an incoming event.
 *
 * STALL only catches a recogniser that says *nothing at all*. This catches the
 * other dead end the field hit: one that meters audio (volume events keep the
 * wave alive) yet never returns a transcript and never ends, leaving the screen
 * on "listening" until the person gives up. At the cap we `stop()` (which
 * delivers any partial as a final result), and if even that is ignored we
 * `release()` — an abort — so the session always lands on a transcript or the
 * calm miss, never an endless spinner. Set a beat above STALL so the no-event
 * path reports first.
 *
 * Sized to the same 20 s as the server's streamed-audio cap
 * (STREAM_MAX_SESSION_MS), not the old 9.5 s: Android's intent allows a 6 s
 * minimum plus 3.5 s of complete silence (EXTRA_SPEECH_INPUT_* below), and the
 * longer pause allowance lets a speaker resume after ~6 s, so a cap near 9.5 s
 * cut people off right after the pause. A dead recogniser still resolves within
 * 20 s, and nothing longer than that could be streamed anyway.
 */
const MAX_LISTEN_MS = STREAM_MAX_SESSION_MS;

/**
 * A streamed sentence ends the way the recogniser's own endpointing would: this
 * long after the last word, or — if nothing is said at all — after this long.
 */
const HARD_STOP_MS = 1800;

/** How soon after our own stop an audio error is taken as that stop's echo. */
const STOP_ECHO_MS = 1500;

/**
 * An engine that says "no speech" this soon after opening has not listened: the
 * person has barely drawn breath. Android's recogniser does exactly that on a
 * cold first session (it gives up within a second, before a word is possible),
 * which read as the mic closing on its own. A miss inside this window, with
 * nothing heard, is retried once without a word on screen; a real silence,
 * later than this, still lands on the calm miss.
 */
const EARLY_MISS_MS = 3000;
/** How long to wait for the aborted session's `end` before retrying anyway. */
const EARLY_RETRY_FALLBACK_MS = 1500;

/**
 * How long an attempt may listen with no transcript at all before it is judged
 * mute. A live recogniser emits interim results within about a second of speech;
 * this beat past that with nothing back means this engine is not transcribing.
 * On an on-device attempt that triggers a one-time fall back to the network
 * engine (which speaks English on any connected phone) — the field's silent
 * on-device model, heard-but-no-words, fixed in place.
 */
const PROGRESS_MS = 3800;

/** What the capture knows about a finished sentence besides its text. */
export interface VoiceDoneInfo {
  /** True when it came from the live Deepgram stream, not the on-device recogniser. */
  readonly streamed: boolean;
  /** The engine's other hypotheses for it, best first (empty when it gave one). */
  readonly alternatives: readonly string[];
}

/**
 * What the screen's fixed top area needs from the mic: the screen draws the
 * mic, the status pill and the wave once above the sheet, so this panel reports
 * their state up and draws only the sheet's share (the transcript and cards).
 */
export interface CaptureStage {
  status: VoiceStatusKey;
  micMode: MicMode;
  onMicPress: () => void;
  level: SharedValue<number>;
}

export interface VoiceCaptureProps {
  /** Reports the mic's state to the screen's top area; null when this unmounts. */
  onStage?: (stage: CaptureStage | null) => void;
  /**
   * Called with the final sentence once the speaker stops. `info.streamed` is
   * true when it came from the live Deepgram stream (advanced voice) rather
   * than the on-device recogniser; `info.alternatives` are the engine's other
   * hypotheses for it (its n-best list without the top one, best first — empty
   * when the engine gave only one).
   */
  onDone: (transcript: string, info: VoiceDoneInfo) => void;
  /**
   * Stream the mic to Deepgram for the advanced voice agent (Pro). If the token
   * or the stream cannot be had, the capture quietly uses the on-device
   * recogniser, exactly as when this is off.
   */
  streamLive?: boolean;
  /**
   * Whether `streamLive` is settled. While the entitlement is still loading the
   * mic waits briefly for it rather than starting on the on-device engine.
   */
  agentReady?: boolean;
  /**
   * The last answer this phone saw for "advanced voice is on", while
   * `agentReady` is false: `false` opens the on-device recogniser at once
   * instead of waiting for the live answer, `true` records from the press and
   * waits as before, `null` (never seen) waits only briefly. See
   * `planAgentWait`.
   */
  agentLastKnown?: boolean | null;
  /**
   * The person's consent to cloud voice, when advanced voice is on for them but
   * they have not agreed (or switched it off): the mic then stays on-device and
   * the badge says why. Omit when advanced voice is not on for them at all.
   */
  cloudConsent?: VoiceCloudConsent;
  /** Told which engine is in use (and why, when it is the on-device one). */
  onEngine?: (info: VoiceEngineInfo) => void;
  /** The group the mic was opened from — a hint for the stream's name keyterms. */
  groupId?: string | null;
  /**
   * Words to bias the recogniser towards — the people the sentence may name.
   * Android passes them as EXTRA_BIASING_STRINGS (API 33+), iOS as the
   * request's contextualStrings; the live stream sends them as keyterms.
   */
  hints?: readonly string[];
  /** The reader's own group names, for the "Try saying…" card's group example.
   *  Separate from `hints`, which may carry any word worth biasing towards. */
  groupNames?: readonly string[];
  /**
   * The last utterance was heard but carried no amount — the screen parsed it
   * and came back empty. The panel shows a calm "didn't catch an amount" recovery
   * with the mic as the only way forward, rather than a separate warning and
   * button stacked around it.
   */
  missed?: boolean;
  /**
   * Fired the moment a fresh utterance begins, so the screen can clear a prior
   * `missed`. The mic is the retry: tapping it is what dismisses the miss state.
   */
  onListen?: () => void;
  /**
   * Open the mic on mount. True for the first attempt (the reader tapped a mic to
   * get here, so opening it saves a tap); false when arriving on a miss, where the
   * recovery copy should sit and wait for a deliberate tap rather than reopening
   * the mic under a message the reader has not read yet.
   */
  autoStart?: boolean;
  /**
   * A push-to-talk hold has ended and this capture is the one it was speaking
   * into: `send` finishes the utterance the way the stop button does, `cancel`
   * drops it without a transcript. `seq` distinguishes one ending from the next.
   *
   * It may arrive before the recogniser is open — the finger can lift while the
   * permission call and the model probe are still being awaited — in which case
   * it is latched and applied the moment the mic actually opens.
   */
  endSignal?: { seq: number; mode: 'send' | 'cancel' } | null;
  /**
   * The `endSignal` has been taken care of. The screen clears it here rather
   * than on a timer, so a later capture (the panel is remounted for each one)
   * cannot be closed by an ending that belonged to an earlier one.
   */
  onEndConsumed?: () => void;
  /**
   * The words of the last sentence the screen read and found no amount in, so
   * the miss can say what it heard instead of a bare "no amount".
   */
  heard?: string;
  /** A suggestion row was tapped. Rows are tappable only when this is given
   *  and `canPick` allows the row. */
  onSuggestion?: (suggestion: Suggestion) => void;
  canPick?: (suggestion: Suggestion) => boolean;
}

function recognitionAvailable(): boolean {
  try {
    return ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    return false;
  }
}

/**
 * Whether an on-device English model is actually installed on this phone.
 *
 * `supportsOnDeviceRecognition()` only says the phone can do on-device work at
 * all — not that the model for the language we are about to ask for is present.
 * Requiring on-device for a locale whose model is not downloaded is the quiet
 * failure this screen hit: the recogniser starts, hears the words, and returns
 * nothing, because it was told to use a model that is not there. So on-device is
 * requested only when English is in `installedLocales`; otherwise the mic falls
 * back to network recognition, which speaks English everywhere. (An empty or
 * throwing probe — Android 12 and below, a missing service — resolves to `false`
 * and the network path, which works, rather than the on-device path, which may
 * not.)
 */
async function probeEnglishInstalled(): Promise<boolean> {
  let supportsOnDevice = false;
  try {
    supportsOnDevice = ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
  } catch {
    supportsOnDevice = false;
  }
  if (!supportsOnDevice) return false;

  let androidRecognitionServicePackage: string | undefined;
  try {
    const pkg = ExpoSpeechRecognitionModule.getDefaultRecognitionService?.().packageName;
    if (pkg) androidRecognitionServicePackage = pkg;
  } catch {
    // iOS / older builds have no Android service concept — query without one.
  }
  const { installedLocales } = await ExpoSpeechRecognitionModule.getSupportedLocales(
    androidRecognitionServicePackage ? { androidRecognitionServicePackage } : {},
  );
  return (installedLocales ?? []).some(
    (tag) => tag.trim().split(/[-_]/)[0]?.toLowerCase() === 'en',
  );
}

/**
 * The installed-model answer, asked once and shared (see `createModelProbe`).
 *
 * `getSupportedLocales` is slow on Android, and it used to be asked on every
 * start, between the tap and the mic. It is now warmed after the app's first
 * frame, so a start reads an answer that is already in hand. A `true` is kept
 * for the process: the probe is flaky right after a recognition session ends
 * (Android's RecognitionService is briefly busy and answers a false "no"), and
 * a model is not uninstalled between two utterances. A `false` is asked again
 * after the app returns to the foreground, in case one was installed meanwhile.
 */
const modelProbe = createModelProbe(probeEnglishInstalled);
const englishInstalledOnDevice = (): Promise<boolean> => modelProbe.get();

/**
 * The microphone and speech permissions, known granted for this foreground.
 *
 * `requestPermissionsAsync` was called on every start. The cheap
 * `getPermissionsAsync` is asked first now, the request only made when that
 * says no, and a grant is remembered until the app next leaves the foreground —
 * where Android's one-time permission can lapse and Settings can revoke it.
 */
let permissionGranted = false;

async function ensurePermission(): Promise<{ granted: boolean; canAskAgain: boolean }> {
  if (permissionGranted) return { granted: true, canAskAgain: true };
  try {
    const current = await ExpoSpeechRecognitionModule.getPermissionsAsync();
    if (current.granted) {
      permissionGranted = true;
      return current;
    }
  } catch {
    // Fall through to the request, which answers for itself.
  }
  const asked = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
  if (asked.granted) permissionGranted = true;
  return asked;
}

/**
 * Get the slow parts of a start out of the way before anybody taps: the
 * installed-model probe and the permission read. Never prompts and never opens
 * the mic. Called after the app's first frame and again on each return to the
 * foreground (see `useVoiceWarmup`).
 */
export function warmVoiceCapture(): void {
  if (!recognitionAvailable()) return;
  // Not while a session is live or tearing down: that is exactly when the
  // locale probe answers a false "no", and the answer is now kept.
  if (speechMic.state !== 'idle') return;
  void modelProbe.get();
  void ExpoSpeechRecognitionModule.getPermissionsAsync()
    .then((current) => {
      if (current.granted) permissionGranted = true;
    })
    .catch(() => {});
}

/**
 * The app went to the background: forget what may have changed while it was
 * away — a negative model answer (one may get installed from Settings) and the
 * permission grant (it may be revoked, or lapse if it was one-time).
 */
export function coolVoiceCapture(): void {
  modelProbe.invalidate();
  permissionGranted = false;
}

export function VoiceCapture({
  onDone,
  hints,
  groupNames = [],
  missed,
  onListen,
  autoStart = true,
  endSignal = null,
  onEndConsumed,
  streamLive = false,
  agentReady = true,
  agentLastKnown = null,
  cloudConsent = 'granted',
  onEngine,
  groupId = null,
  heard = '',
  onSuggestion,
  canPick,
  onStage,
}: VoiceCaptureProps) {
  const theme = useTheme();
  const { t, locale } = useStrings();

  const [available] = useState(recognitionAvailable);
  // Everything this panel knows about the mic — starting or open, the words so
  // far, and why it stopped without any — is one reducer (lib/voiceFlowPure),
  // so the status line, the transcript and the miss can never disagree.
  // `starting` from the first render when the panel opens the mic by itself, so
  // a tap is answered within a frame.
  const [micState, dispatch] = useReducer(
    captureReducer,
    autoStart && recognitionAvailable(),
    initialCapture,
  );
  const listening = micState.mic === 'listening';
  const live = micState.final ? '' : micState.transcript;
  // The latest entitlement, read when the mic actually opens: the auto-start on
  // mount captured whatever the first render held, which is how a tap could open
  // on the on-device engine before the flag had loaded.
  const streamLiveRef = useRef(streamLive);
  const agentReadyRef = useRef(agentReady);
  const agentLastKnownRef = useRef(agentLastKnown);
  const cloudConsentRef = useRef(cloudConsent);
  const onEngineRef = useRef(onEngine);
  useEffect(() => {
    streamLiveRef.current = streamLive;
    agentReadyRef.current = agentReady;
    agentLastKnownRef.current = agentLastKnown;
    cloudConsentRef.current = cloudConsent;
    onEngineRef.current = onEngine;
  });
  const reportEngine = useCallback((info: VoiceEngineInfo): void => {
    onEngineRef.current?.(info);
  }, []);
  // How the live sentence ends, decided at the start (tap: silence; hold: release).
  const endRules = useRef<Pick<MicStartPlan, 'silenceMs' | 'firstWordMs'>>({
    silenceMs: null,
    firstWordMs: null,
  });
  // Live input loudness, 0…1, eased from the recogniser's volume events. The
  // waveform rides this so it answers the actual voice instead of looping on a
  // fixed clock; it stays 0 when the mic is shut.
  const level = useSharedValue(0);
  const sampleLevel = useCallback(
    (value: number): void => {
      level.set(withTiming(value, { duration: 90 }));
    },
    [level],
  );

  // The latest transcript, kept in a ref so the 'end' handler reads the final
  // one without waiting on a state update.
  const latest = useRef('');
  // The recogniser's other hypotheses for `latest`, best first.
  const latestAlternatives = useRef<string[]>([]);
  // The live Deepgram stream, while one is open (advanced voice).
  const stream = useRef<LiveTranscription | null>(null);
  // The mic recording since the press, before the stream is attached (or the
  // start falls back to on-device and discards it). See lib/voiceStream.
  const capture = useRef<MicCapture | null>(null);
  const dropCapture = useCallback(async (): Promise<void> => {
    const held = capture.current;
    capture.current = null;
    await held?.discard();
  }, []);
  // The silence timer that ends a streamed sentence the way the recogniser's own
  // endpointing ends an on-device one.
  const streamSilence = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamMax = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  // Guards the one auto-start so a re-render never reopens the mic.
  const started = useRef(false);

  // This instance's claim on the single recogniser (see lib/speechMic). Minted
  // once per mount, and the answer to "is this event mine?" — the events are
  // global, so a panel that does not hold the mic must ignore every one of them.
  // In particular the `end` a *previous* panel's abort still owes belongs to
  // nobody, and closing this capture on it is what left the second attempt dead.
  const [session] = useState(() => Symbol('voice-capture'));

  // A push-to-talk hold ended before the recogniser was open, so its ending is
  // waiting here for the native start to be issued. See `endSignal`.
  const pendingEnd = useRef<'send' | 'cancel' | null>(null);

  // A start is already on its way — the mic is claimed but the native call has
  // not been made yet, because a permission check and an installed-model probe
  // are awaited first. Two taps inside that window would otherwise both see an
  // idle mic and issue two native starts, the second destroying the first.
  const starting = useRef(false);

  // Nothing at all has come back from this session yet. Armed when the native
  // start is issued, disarmed by the first event of any kind; if it fires, the
  // recogniser never woke up and the panel says so instead of sitting on
  // "listening" forever.
  const stall = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearStall = useCallback((): void => {
    if (stall.current === null) return;
    clearTimeout(stall.current);
    stall.current = null;
  }, []);

  // The hard listening cap (see MAX_LISTEN_MS) — armed at open, cleared only by a
  // terminal event or unmount, never by a mid-session event.
  const maxListen = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearMaxListen = useCallback((): void => {
    if (maxListen.current === null) return;
    clearTimeout(maxListen.current);
    maxListen.current = null;
  }, []);

  // Lifecycle facts for the failure diagnostic: whether any transcript came back,
  // how many volume packets arrived (did audio reach the recogniser at all), and
  // which engine this attempt used. Surfaced only when a capture fails, so a
  // device where voice silently does nothing can be told apart — audio-but-no-
  // words (engine broken) from no-audio (mic/permission) — without a cable.
  const gotResult = useRef(false);
  const usedOnDevice = useRef(false);
  // A one-time on-device -> network fallback has already been spent this attempt.
  const retried = useRef(false);
  // The no-transcript watchdog (see PROGRESS_MS), armed at open.
  const progress = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The early-miss retry (see EARLY_MISS_MS): when the recogniser opened, whether
  // this user-started capture has already spent its one silent retry, and
  // whether one is waiting on the aborted session's `end`.
  const openedAt = useRef(0);
  // When this panel last asked the recogniser to stop — so an audio error that
  // is only the echo of that stop is not reported as a busy microphone.
  const stoppedAt = useRef(0);
  // Every stop this panel asks for goes through here — the stop button, a
  // push-to-talk release, the hard listening cap — so each one is stamped, and
  // an audio error that is only its echo is recognised whichever it was.
  const stopListening = useCallback((): void => {
    stoppedAt.current = Date.now();
    speechMic.stop(session);
  }, [session]);
  const earlyRetryUsed = useRef(false);
  const earlyRetryPending = useRef(false);
  const autoRetrying = useRef(false);
  const earlyRetryFallback = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearProgress = useCallback((): void => {
    if (progress.current === null) return;
    clearTimeout(progress.current);
    progress.current = null;
  }, []);
  // The latest `start`, reached indirectly so the fallback watchdog inside
  // `start` can re-enter it without naming the still-declaring const.
  const startRef = useRef<(forceNetwork?: boolean) => void>(() => {});
  // Which engine the current attempt used — the setup-offline offer keys off a
  // network miss (its recogniser can be dead on a device with no on-device model).
  const [engine, setEngine] = useState<'on-device' | 'network' | null>(null);
  // On-device recognition is supported here but the English model is not yet
  // installed — probed once on mount. Surfaces the setup offer before a failure,
  // for devices whose network recogniser is unreliable.
  const [offlineEligible, setOfflineEligible] = useState(false);
  // A one-off setup for a device whose network recogniser hears audio but returns
  // no words: pull the on-device English model down, then recognition runs
  // on-device and skips the broken network path. A status line for the download.
  const [downloading, setDownloading] = useState(false);
  const [downloadMsg, setDownloadMsg] = useState<string | null>(null);

  useSpeechRecognitionEvent('start', () => {
    if (!speechMic.owns(session)) return;
    clearStall();
  });

  useSpeechRecognitionEvent('result', (event) => {
    if (!speechMic.owns(session)) return;
    clearStall();
    clearProgress();
    gotResult.current = true;
    const transcript = event.results[0]?.transcript ?? '';
    latest.current = transcript;
    latestAlternatives.current = event.results
      .slice(1, MAX_ALTERNATIVES)
      .map((result) => result.transcript.trim())
      .filter((text) => text && text !== transcript.trim());
    dispatch({ type: 'partial', text: transcript });
  });

  // The recogniser's own metering (enabled via volumeChangeEventOptions in
  // start). `value` runs −2…10, where below 0 is inaudible; normalise to 0…1 and
  // ease so the wave tracks loudness without twitching on every packet.
  useSpeechRecognitionEvent('volumechange', (event) => {
    if (!speechMic.owns(session)) return;
    clearStall();
    const norm = Math.max(0, Math.min(1, event.value / 10));
    sampleLevel(norm);
  });

  // Retry the capture once, silently, after an early miss (see EARLY_MISS_MS).
  // The listening state is kept on throughout, so the screen never flashes a
  // miss for a session the person never had a chance to speak into.
  const runEarlyRetry = (): void => {
    if (earlyRetryFallback.current) clearTimeout(earlyRetryFallback.current);
    earlyRetryFallback.current = null;
    if (!earlyRetryPending.current) return;
    earlyRetryPending.current = false;
    if (!mounted.current) return;
    autoRetrying.current = true;
    void startRef.current(false);
  };

  useSpeechRecognitionEvent('error', (event) => {
    if (!speechMic.owns(session)) return;
    clearStall();
    clearMaxListen();
    clearProgress();
    const early =
      (event.error === 'no-speech' || event.error === 'speech-timeout') &&
      !gotResult.current &&
      !latest.current.trim() &&
      !earlyRetryUsed.current &&
      Date.now() - openedAt.current < EARLY_MISS_MS;
    if (early) {
      earlyRetryUsed.current = true;
      earlyRetryPending.current = true;
      speechMic.errored(session);
      // The retry waits for this session's `end`; if that never arrives, it goes
      // ahead anyway rather than leave the screen on "listening" with no mic.
      earlyRetryFallback.current = setTimeout(runEarlyRetry, EARLY_RETRY_FALLBACK_MS);
      return;
    }
    // Android's on-device recogniser answers a stop that came before it had any
    // audio with ERROR_AUDIO ("audio-capture"), which reads as "the microphone is
    // busy" — untrue, and alarming. When we asked for the stop a moment ago it is
    // just an empty capture: the miss below says "Didn't catch that" on its own.
    const selfInflicted =
      event.error === 'audio-capture' && Date.now() - stoppedAt.current < STOP_ECHO_MS;
    const message = selfInflicted ? '' : dictationError(event.error, t.misc.dictationErrors);
    // Silence is not a failure: it gets the "Didn't catch that" state, not
    // "Something went wrong" over the same advice.
    if (event.error === 'no-speech' || event.error === 'speech-timeout')
      dispatch({ type: 'noSpeech' });
    else if (message) {
      const permission = isPermissionError(event.error);
      dispatch({ type: 'error', message, permission, settings: permission });
    } else dispatch({ type: 'closed' });
    level.set(withTiming(0, { duration: 150 }));
    // Ownership is held for the `end` that follows, so it is still recognised as
    // this session's; the arbiter arms its own guard in case that `end` never
    // comes.
    speechMic.errored(session);
  });

  useSpeechRecognitionEvent('end', () => {
    // Told either way: the recogniser really has finished, and the next capture
    // is waiting on exactly this to know it may open. The answer decides whether
    // the ending was *this* capture's — which is not the same as owning the mic
    // right now. A previous session's teardown can report in late, after the
    // guard timer settled it and this panel opened; the arbiter swallows it, and
    // this panel must not act on it either, or it closes a capture that has
    // barely started.
    if (!speechMic.ended(session)) return;
    clearStall();
    clearMaxListen();
    clearProgress();
    if (earlyRetryPending.current) {
      // A beat for the recogniser to let go before it is asked again.
      if (earlyRetryFallback.current) clearTimeout(earlyRetryFallback.current);
      earlyRetryFallback.current = setTimeout(runEarlyRetry, 250);
      return;
    }
    level.set(withTiming(0, { duration: 150 }));
    const said = latest.current.trim();
    if (said) {
      dispatch({ type: 'final', text: said });
      onDone(said, { streamed: false, alternatives: latestAlternatives.current });
    }
    // Heard nothing usable — surface the same calm recovery a parsed miss shows,
    // rather than silently dropping back to the opening prompt as if nothing had
    // been tried, and record why so a silent-mic device can be diagnosed.
    else dispatch({ type: 'noSpeech' });
  });

  // ── Live streaming (advanced voice) ───────────────────────────────────────
  const clearStreamTimers = useCallback((): void => {
    if (streamSilence.current) clearTimeout(streamSilence.current);
    if (streamMax.current) clearTimeout(streamMax.current);
    streamSilence.current = null;
    streamMax.current = null;
  }, []);

  // End the streamed sentence: stop the mic, let Deepgram flush, hand the whole
  // transcript to the screen. Always gives the mic claim back.
  const finishStream = useCallback(async (): Promise<void> => {
    const live = stream.current;
    if (!live) return;
    stream.current = null;
    starting.current = false;
    clearStreamTimers();
    // The mic is shut; the words heard so far stay on screen while the stream
    // flushes, which reads as "understanding", never as a reset.
    dispatch({ type: 'closed' });
    level.set(withTiming(0, { duration: 150 }));
    // Bounded: a socket that never answers the close must not hold the screen.
    const said = (
      await Promise.race([
        live.stop(),
        new Promise<string>((resolve) =>
          setTimeout(() => {
            live.cancel();
            resolve(latest.current);
          }, STOP_GRACE_MS),
        ),
      ])
    ).trim();
    if (!mounted.current) return;
    speechMic.release(session);
    if (said) {
      latest.current = said;
      dispatch({ type: 'final', text: said });
      onDone(said, { streamed: true, alternatives: live.alternatives() });
    } else dispatch({ type: 'noSpeech' });
  }, [clearStreamTimers, level, onDone, session]);
  const finishStreamRef = useRef(finishStream);
  useEffect(() => {
    finishStreamRef.current = finishStream;
  }, [finishStream]);

  /**
   * Attach the stream to the capture already recording. Anything but
   * 'streaming' means "use the on-device recogniser" (the caller discards the
   * capture); 'quota' (the relay answered 402) also names why.
   */
  const beginStream = useCallback(
    async (mic: MicCapture): Promise<'streaming' | 'quota' | 'failed'> => {
      const got = await getStreamSession({ groupId, locale });
      if (!mounted.current) return 'failed';
      if (got.kind !== 'ok') return got.kind === 'quota' ? 'quota' : 'failed';
      // An ending that came while the session was being read is applied here.
      if (pendingEnd.current === 'cancel') return 'failed';
      const armSilence = (ms: number): void => {
        if (streamSilence.current) clearTimeout(streamSilence.current);
        streamSilence.current = setTimeout(() => void finishStreamRef.current(), ms);
      };
      const hear = (text: string): void => {
        // Deepgram keeps sending the finished sentence while the room is quiet;
        // only new words restart the silence clock, or it never runs out and
        // every take lasts until the 20 s cap.
        const changed = text.trim() !== latest.current.trim();
        latest.current = text;
        dispatch({ type: 'partial', text });
        const { silenceMs } = endRules.current;
        if (changed && text.trim() && silenceMs !== null) {
          armSilence(pauseAllowanceMs(text, silenceMs));
        }
      };
      const attached = await attachStream(mic, got.session, {
        onInterim: hear,
        onFinal: hear,
        onError: () => {
          // The stream died mid-sentence: keep what was heard, if anything.
          const said = latest.current.trim();
          const alternatives = stream.current?.alternatives() ?? [];
          stream.current = null;
          starting.current = false;
          clearStreamTimers();
          level.set(withTiming(0, { duration: 150 }));
          speechMic.release(session);
          if (said) {
            dispatch({ type: 'final', text: said });
            onDone(said, { streamed: true, alternatives });
          } else dispatch({ type: 'error', message: t.misc.dictationFailed });
        },
      });
      if (attached.kind !== 'ok') return attached.kind === 'quota' ? 'quota' : 'failed';
      const live = attached.live;
      if (!mounted.current) {
        live.cancel();
        return 'failed';
      }
      // The stream owns the recorder now.
      if (capture.current === mic) capture.current = null;
      stream.current = live;
      dispatch({ type: 'opened' });
      // `starting` stays set while the stream is live: a second start (an
      // auto-start racing the tap) must not open a second recording.
      // The timers count from when the recorder started, not from the attach.
      const now = Date.now();
      if (endRules.current.firstWordMs !== null) {
        armSilence(
          remainingFrom(mic.startedAt, now, endRules.current.firstWordMs, ATTACH_FLOOR_MS),
        );
      }
      streamMax.current = setTimeout(
        () => void finishStreamRef.current(),
        remainingFrom(mic.startedAt, now, STREAM_MAX_SESSION_MS, ATTACH_FLOOR_MS),
      );
      // The finger lifted while the stream was opening.
      if (pendingEnd.current !== null) {
        pendingEnd.current = null;
        void finishStream();
      }
      return 'streaming';
    },
    [clearStreamTimers, finishStream, groupId, level, locale, onDone, session, t],
  );

  const openMic = useCallback(
    async (forceNetwork = false): Promise<void> => {
      // One start at a time from this panel, and one capture at a time in the app.
      // A live stream is a capture in progress too.
      if (starting.current || stream.current) return;
      starting.current = true;
      const mark = startTimer();
      // A fresh user-initiated start re-arms the one-time network fallback; a
      // fallback re-entry keeps it spent. Either way, drop the old attempt's
      // watchdogs before opening the next.
      if (!forceNetwork) retried.current = false;
      // A tap is a fresh capture with its own one early-miss retry; the silent
      // retry itself must not re-arm it, or a dead mic would loop.
      if (!autoRetrying.current) earlyRetryUsed.current = false;
      autoRetrying.current = false;
      earlyRetryPending.current = false;
      clearStall();
      clearMaxListen();
      clearProgress();
      // Still holding the mic from a session the panel has already given up on —
      // an error whose `end` never arrived, say. The tap is a deliberate retry, so
      // let go of the old session here; the claim below then waits for its
      // teardown rather than opening a second recogniser on top of it.
      if (speechMic.owns(session)) speechMic.release(session);
      // Speaking again is the retry: the reducer's `start` clears every miss and
      // error as the mic opens; the screen drops any parsed miss it still holds.
      dispatch({ type: 'start' });
      onListen?.();
      latest.current = '';
      latestAlternatives.current = [];
      level.set(0);
      gotResult.current = false;

      // Claim the recogniser first, and wait here for any previous session's
      // teardown to land. Everything below must give it back — a claimed mic that
      // is never released is one nothing can reopen.
      const claimed = await speechMic.acquire(session);
      mark('mic claimed');
      if (!mounted.current) {
        starting.current = false;
        if (claimed) speechMic.release(session);
        return;
      }
      if (!claimed) {
        starting.current = false;
        dispatch({ type: 'error', message: t.misc.dictationFailed });
        return;
      }

      const give = (): void => {
        starting.current = false;
        speechMic.release(session);
      };

      const permission = await ensurePermission();
      mark('permission');
      if (!mounted.current) return give();
      if (!permission.granted) {
        // Settings is the cure only once the system stops asking; while it can
        // still ask, tapping the mic again brings the prompt back.
        dispatch({
          type: 'error',
          message: permission.canAskAgain ? t.misc.micPermission : t.misc.micBlocked,
          permission: true,
          settings: !permission.canAskAgain,
        });
        return give();
      }

      // How long to wait for the entitlement, if at all. It used to be up to
      // 1.5 s on every cold start, nearly always to learn "not Pro"; now the
      // last answer this phone saw decides (see `planAgentWait`).
      const wait = planAgentWait({
        ready: agentReadyRef.current,
        streamLive: streamLiveRef.current,
        lastKnown: agentLastKnownRef.current,
        streamAvailable: streamingAvailable(),
      });
      // The connection check only matters to a stream; asked alongside the
      // recorder and the wait rather than after them.
      const onlineCheck = wait.earlyCapture || streamLiveRef.current ? checkOnline() : null;

      // Advanced voice records from the press: the mic starts here, before the
      // flag wait, the online check and the token, and buffers until the stream
      // attaches — otherwise the first words fell into those round trips. Only
      // once the recorder has reported started does the panel say "Listening".
      if (wait.earlyCapture) {
        capture.current = await startCapture({ onLevel: sampleLevel });
        mark('recorder started');
        if (!mounted.current) {
          await dropCapture();
          return give();
        }
        // "Listening" only when this recording is the one that will be heard.
        // While the entitlement is still unknown it may yet be dropped for the
        // on-device recogniser, so the panel stays on "Starting…" until then.
        if (capture.current && streamLiveRef.current) dispatch({ type: 'opened' });
      }

      // Advanced voice: stream to Deepgram via the relay. A refusal (offline, 503,
      // 429) or a stream that will not open drops straight to the on-device
      // recogniser below, unchanged.
      // Tap, hold, retry and auto-start all come through here, so none of them
      // can pick a different engine. The entitlement is read now, not from the
      // render this start was created in; a flag still loading is waited for.
      for (let waited = 0; !agentReadyRef.current && waited < wait.waitMs; waited += 50) {
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
      if (wait.waitMs > 0) mark(agentReadyRef.current ? 'agent status in' : 'agent wait gave up');
      if (!mounted.current) {
        await dropCapture();
        return give();
      }
      const online = streamLiveRef.current ? await (onlineCheck ?? checkOnline()) : true;
      if (!mounted.current) {
        await dropCapture();
        return give();
      }
      const plan = planMicStart({
        // Advanced voice is on for them when they could stream or only lack consent.
        enabled: streamLiveRef.current || cloudConsentRef.current !== 'granted',
        consent: cloudConsentRef.current,
        online,
        held: pushToTalk.getSnapshot().holding,
        streamAvailable: streamingAvailable(),
      });
      endRules.current = plan;
      if (plan.stream) {
        const opened = capture.current ? await beginStream(capture.current) : 'failed';
        mark(`stream ${opened}`);
        if (opened === 'streaming') {
          reportEngine(CLOUD);
          return;
        }
        // The relay, the socket or the mic would not open: carry on locally.
        // A 402 from the relay is the month's allowance, not the connection.
        reportEngine(
          resolveEngine({
            enabled: true,
            online: await checkOnline(),
            quotaReached: opened === 'quota',
            streamOk: false,
            streamAvailable: streamingAvailable(),
          }),
        );
      } else if (plan.fallback) reportEngine(plan.fallback);
      // On-device from here: the early recording is dropped (and the mic freed
      // for the recogniser), and "Listening" waits for the recogniser itself.
      if (capture.current) {
        await dropCapture();
        // Back to "getting ready" until the recogniser itself is open.
        dispatch({ type: 'start' });
        level.set(0);
      }
      if (!mounted.current) return give();
      // A push-to-talk cancel that landed while the token was in flight.
      const endedEarly = pendingEnd.current as 'send' | 'cancel' | null;
      if (endedEarly === 'cancel') {
        pendingEnd.current = null;
        dispatch({ type: 'cancel' });
        return give();
      }

      // On-device only when an English model is actually installed; otherwise the
      // recogniser is left to use the network, which speaks English on every phone.
      // Requiring on-device for a model that is not there is what returned silence.
      const onDevice = forceNetwork ? false : await englishInstalledOnDevice();
      mark(`model probe (${onDevice ? 'on-device' : 'network'})`);
      if (!mounted.current) return give();
      usedOnDevice.current = onDevice;
      setEngine(onDevice ? 'on-device' : 'network');

      try {
        ExpoSpeechRecognitionModule.start({
          // Recognition is English-only — the surface each speaker reads is still
          // localised, but the mic listens in English (device region where it can,
          // else en-IN), so there is one locale to get right and no chip to miss.
          lang: englishSpeechLocale(locale),
          interimResults: true,
          // The n-best list: names are scored across every hypothesis, so an
          // engine that heard "rainy" first and "Renny" second still finds her.
          maxAlternatives: MAX_ALTERNATIVES,
          // One sentence, then it settles — the same shape a note dictation uses.
          continuous: false,
          requiresOnDeviceRecognition: onDevice,
          addsPunctuation: onDevice,
          // Meter the input so the waveform can ride real loudness (~10 Hz is
          // plenty for a smooth wave and cheap to ease over).
          volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
          contextualStrings: hints && hints.length > 0 ? [...hints] : undefined,
          iosTaskHint: 'dictation',
          // People start with a greeting and a beat of thought — "hello… uh… add
          // 500 to Goa". Android's default endpointing finalises on that first
          // pause, ending the session on the greeting alone. Give it room: keep
          // listening for at least a few seconds, and do not treat a pause to
          // think (two or three seconds) as the end of speech. (Android-only extras; iOS endpointing is
          // already more forgiving and ignores these.)
          androidIntentOptions: {
            EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 6000,
            EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 3500,
            EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 3000,
          },
        });
        speechMic.opened(session);
        mark('recogniser started');
        dispatch({ type: 'opened' });
        openedAt.current = Date.now();
        stoppedAt.current = 0;
        starting.current = false;

        // The finger lifted while this was still opening. Apply that ending now
        // it can be applied: `stop` squeezes out whatever was said, `release`
        // aborts and — by dropping ownership — makes the `end` that follows
        // belong to nobody, so no transcript and no miss reaches the screen.
        if (pendingEnd.current !== null) {
          const ending = pendingEnd.current;
          pendingEnd.current = null;
          if (ending === 'cancel') {
            clearStall();
            clearMaxListen();
            clearProgress();
            dispatch({ type: 'cancel' });
            level.set(withTiming(0, { duration: 150 }));
            speechMic.release(session);
            return;
          }
          stopListening();
        }

        // No transcript yet; if none arrives by PROGRESS_MS this engine is not
        // transcribing. An on-device attempt falls back once to the network engine
        // (the field's silent on-device model); a network attempt that is already
        // mute is left to STALL / the hard cap to resolve.
        clearProgress();
        progress.current = setTimeout(() => {
          progress.current = null;
          if (!mounted.current || !speechMic.owns(session) || gotResult.current) return;
          if (usedOnDevice.current && !retried.current) {
            retried.current = true;
            startRef.current(true);
          }
        }, PROGRESS_MS);

        // Nothing has come back yet; if nothing ever does, the recogniser was
        // torn down under us and the panel must say so rather than pretend.
        clearStall();
        stall.current = setTimeout(() => {
          stall.current = null;
          if (!mounted.current || !speechMic.owns(session)) return;
          clearMaxListen();
          clearProgress();
          level.set(withTiming(0, { duration: 150 }));
          dispatch({ type: 'error', message: t.misc.dictationFailed });
          speechMic.release(session);
        }, STALL_MS);

        // The hard cap: a recogniser that meters audio but never finalises would
        // otherwise sit on "listening" forever (STALL is cleared by those volume
        // events). At the cap, stop() to squeeze out any partial as a final; if it
        // is still holding on after HARD_STOP_MS, release() aborts it and the
        // capture lands on the calm miss with a diagnostic.
        clearMaxListen();
        maxListen.current = setTimeout(() => {
          maxListen.current = null;
          if (!mounted.current || !speechMic.owns(session)) return;
          stopListening();
          setTimeout(() => {
            if (!mounted.current || !speechMic.owns(session)) return;
            level.set(withTiming(0, { duration: 150 }));
            const said = latest.current.trim();
            if (said) {
              dispatch({ type: 'final', text: said });
              onDone(said, { streamed: false, alternatives: latestAlternatives.current });
            } else dispatch({ type: 'noSpeech' });
            speechMic.release(session);
          }, HARD_STOP_MS);
        }, MAX_LISTEN_MS);
      } catch {
        dispatch({ type: 'error', message: t.misc.dictationFailed });
        give();
      }
    },
    [
      clearMaxListen,
      clearProgress,
      clearStall,
      hints,
      level,
      locale,
      onDone,
      onListen,
      beginStream,
      dropCapture,
      sampleLevel,
      session,
      stopListening,
      reportEngine,
      t,
    ],
  );

  // Every way in — tap, hold, auto-start, retry — shows "Starting…" the instant
  // it is asked, and drops it once the mic is open (or has failed to open).
  const start = useCallback(
    async (forceNetwork = false): Promise<void> => {
      // A start already on its way owns the "Starting…" state; leave it be.
      if (starting.current || stream.current) return;
      dispatch({ type: 'start' });
      try {
        await openMic(forceNetwork);
      } finally {
        if (mounted.current) dispatch({ type: 'settled' });
      }
    },
    [openMic],
  );

  // Point the recursion handle at the current start on every change.
  useEffect(() => {
    startRef.current = start;
  }, [start]);

  const setupOffline = useCallback(async (): Promise<void> => {
    if (downloading) return;
    setDownloading(true);
    setDownloadMsg(t.voice.offlineDownloading);
    try {
      const { status } = await ExpoSpeechRecognitionModule.androidTriggerOfflineModelDownload({
        locale: englishSpeechLocale(locale),
      });
      if (!mounted.current) return;
      if (status === 'download_success') {
        // The model is on the device now: latch it so the next capture asks for
        // on-device recognition (see englishInstalledOnDevice), and open the mic.
        modelProbe.confirm();
        setOfflineEligible(false);
        setDownloadMsg(t.voice.offlineReady);
        void start();
      } else {
        // Android 13 opens a system download dialog; 14+ may schedule for Wi-Fi.
        // Either way it is not ready this instant — invite a retry shortly.
        setDownloadMsg(t.voice.offlineDownloading);
      }
    } catch {
      if (mounted.current) setDownloadMsg(t.voice.offlineFailed);
    } finally {
      if (mounted.current) setDownloading(false);
    }
  }, [downloading, locale, start, t]);

  const stop = useCallback((): void => {
    if (stream.current) {
      void finishStream();
      return;
    }
    // Recording, but the stream is not attached yet: the start applies the
    // ending once it is (the buffered words are sent first), or on-device.
    if (capture.current) {
      pendingEnd.current = 'send';
      return;
    }
    // Ask the recogniser to finish, but keep the session: `stop()` (unlike
    // `abort()`) still delivers one last `result`, and giving the mic up here
    // would make the handler above drop the words spoken before the tap.
    stopListening();
  }, [finishStream, stopListening]);

  /**
   * The one act this screen offers: open the mic, or close it.
   *
   * It is a named function rather than a lambda on the button because it now has
   * two ways in — the mic itself, and the line of copy under it, which somebody
   * reading "Tap to speak" will very reasonably tap. Two entrances must not mean
   * two implementations: every guard `start` keeps (the claim on the single
   * recogniser, a permission call already in flight, the installed-model probe)
   * and everything `stop` is careful about belong to both taps or to neither.
   */
  const toggle = useCallback((): void => {
    // A live stream is always stoppable, whatever the screen thinks it shows.
    if (listening || stream.current) stop();
    else void start();
  }, [listening, start, stop]);

  // A push-to-talk hold has ended (see `endSignal`). Lifting the finger is the
  // same act as tapping the stop button, so it takes the same path; sliding away
  // is the one that has to differ, because it must not deliver a transcript.
  //
  // The mic may not be open yet — it is opened behind a permission call and an
  // installed-model probe — so an ending that arrives early is latched for the
  // start to apply, rather than dropped on a recogniser that cannot hear it.
  // A cancel takes the screen with it, so there is nothing here to tidy for the
  // eye — the mic is simply given back, and the panel is gone a frame later.
  useEffect(() => {
    if (!endSignal) return;
    // A live stream is past its start (its guard stays set only to refuse a
    // second start), so an ending applies to it now, not later.
    if ((starting.current && !stream.current) || !speechMic.owns(session)) {
      pendingEnd.current = endSignal.mode;
    } else if (endSignal.mode === 'cancel') {
      stream.current?.cancel();
      stream.current = null;
      void dropCapture();
      starting.current = false;
      clearStreamTimers();
      clearStall();
      clearMaxListen();
      clearProgress();
      dispatch({ type: 'cancel' });
      speechMic.release(session);
    } else {
      stop();
    }
    onEndConsumed?.();
    // Only a new ending should act; the callbacks are stable and re-running on
    // them would re-apply an ending already dealt with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endSignal?.seq]);

  // Probe once: is on-device supported but not yet installed? If so, the offline
  // model is worth offering up front — on some devices the network engine hears
  // audio but returns nothing, and the on-device model is the only path that
  // works. A pure read; never triggers a download on its own.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        if (!recognitionAvailable()) return;
        let supports = false;
        try {
          supports = ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
        } catch {
          supports = false;
        }
        if (!supports) return;
        const installed = await englishInstalledOnDevice();
        if (alive && !installed) setOfflineEligible(true);
      } catch {
        // A failing probe just means no proactive offer — the on-miss one remains.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Open the mic as the screen appears — the reader tapped a mic to get here, so
  // making them tap a second one to start would be a step too many. Suppressed
  // when arriving on a miss (`autoStart` false): the recovery copy should be read
  // before the mic reopens, and the mic itself is the retry.
  useEffect(() => {
    if (!available || !autoStart || started.current) return;
    started.current = true;
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, autoStart]);

  // Leaving mid-sentence must not leave the microphone open, and must not leave
  // it claimed either: the panel is remounted (via a changing `key`) to start
  // each new capture, and a claim nobody gives back is a mic the next mount can
  // never open. `release` is the one call for both — it aborts a live session
  // and simply hands back a claim that never got as far as the native start.
  //
  // `mounted` is re-armed on the way in, not just cleared on the way out: this
  // effect is re-run whole by a Fast Refresh, and a flag that only ever goes
  // false would leave every later `start()` bailing out after its first await.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (earlyRetryFallback.current) clearTimeout(earlyRetryFallback.current);
      earlyRetryFallback.current = null;
      earlyRetryPending.current = false;
      clearStall();
      clearMaxListen();
      clearProgress();
      starting.current = false;
      stream.current?.cancel();
      stream.current = null;
      void dropCapture();
      clearStreamTimers();
      speechMic.release(session);
    };
  }, [clearMaxListen, clearProgress, clearStall, clearStreamTimers, dropCapture, session]);

  const suggestions = useVoiceSuggestions(groupNames);

  const flowInput = { phase: 'listening' as const, capture: micState, missed };
  const flow = voiceFlowState(flowInput);
  const status = voiceStatusKey(flow, flowInput);
  // While the mic is still opening a tap could do nothing useful (the start
  // owns the mic), so the button shows it is busy rather than a stop it cannot honour.
  const micMode = micState.mic === 'starting' ? 'busy' : micButtonMode(flow);
  const problem =
    micState.problem && micState.problem.kind !== 'no-speech' ? micState.problem : null;
  // What to show as heard: the words forming now, else the screen's last
  // sentence when it found no amount in it (so the miss says what it heard).
  const shownTranscript = micState.transcript || (missed ? heard : '');
  const shownFinal = micState.final || (!micState.transcript && Boolean(missed && heard));

  // The on-device setup offer: the standing offer while idle (on-device is
  // supported but the English model is missing), or the way out of a miss the
  // network engine caused.
  const showMiss = flow === 'no_speech';
  const offerOffline =
    (flow === 'idle' && !live && offlineEligible) ||
    (showMiss && (engine === 'network' || offlineEligible));

  // Hand the stage the mic's state before paint, so it never shows a stale frame.
  const toggleRef = useRef(toggle);
  useEffect(() => {
    toggleRef.current = toggle;
  });
  const onMicPress = useCallback(() => toggleRef.current(), []);
  const onStageRef = useRef(onStage);
  useEffect(() => {
    onStageRef.current = onStage;
  });
  useLayoutEffect(() => {
    onStageRef.current?.({ status, micMode, onMicPress, level });
  }, [status, micMode, onMicPress, level]);
  useLayoutEffect(() => () => onStageRef.current?.(null), []);

  if (!available) {
    return (
      <Text tone="muted" align="center">
        {t.voice.unavailable}
      </Text>
    );
  }

  return (
    <VoiceSheetBody transcript={shownTranscript} final={shownFinal}>
      {problem ? (
        <VoiceErrorState
          problem={problem}
          onRetry={() => void start()}
          onOpenSettings={() => void Linking.openSettings()}
        />
      ) : null}

      {showSuggestions(flow, shownTranscript) ? (
        <VoiceSuggestions suggestions={suggestions} onPick={onSuggestion} canPick={canPick} />
      ) : null}

      {offerOffline ? (
        <View style={{ alignItems: 'center', gap: theme.spacing.xs }}>
          <Pressable
            accessibilityRole="button"
            disabled={downloading}
            accessibilityState={{ disabled: downloading }}
            onPress={() => void setupOffline()}
            hitSlop={8}
            style={({ pressed }) => ({
              minHeight: 44,
              justifyContent: 'center',
              opacity: downloading ? 0.5 : pressed ? 0.6 : 1,
            })}
          >
            <Text tone="brand" style={{ fontWeight: '600' }}>
              {t.voice.setupOffline}
            </Text>
          </Pressable>
          {downloadMsg ? (
            <Text variant="caption" tone="muted" align="center">
              {downloadMsg}
            </Text>
          ) : null}
        </View>
      ) : null}
    </VoiceSheetBody>
  );
}
