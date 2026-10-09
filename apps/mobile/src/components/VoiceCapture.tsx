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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { Animated, Easing, Linking, Pressable, View } from 'react-native';
import Reanimated, {
  cancelAnimation,
  Easing as ReEasing,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { Button, iconSize, Text, useTheme, type Theme } from '@waves/ui';

import { deviceCountry, fill, useStrings } from '@/i18n';
import { useDefaultCurrency } from '@/lib/currency';
import { exampleCountry, voiceExamples } from '@/lib/voiceExamples';
import { dictationError, englishSpeechLocale, isPermissionError } from '@/lib/dictation';
import { useReducedMotion } from '@/lib/reducedMotion';
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
  planMicStart,
  resolveEngine,
  STREAM_MAX_SESSION_MS,
  type MicStartPlan,
  type VoiceCloudConsent,
  type VoiceEngineInfo,
} from '@/lib/voiceEnginePure';
import { createModelProbe, planAgentWait } from '@/lib/voiceStartPure';
import { VoiceEngineBadge } from '@/components/VoiceEngineBadge';

/**
 * The least a session timer is given once the stream attaches, however long the
 * token took: the buffered audio still has to reach Deepgram and come back.
 */
const ATTACH_FLOOR_MS = 1500;

/** How long Stop waits for the cloud's last words before ending without them. */
const STOP_GRACE_MS = 2000;

const MIC_SIZE = 104;

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
 */
const MAX_LISTEN_MS = 9500;

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

/**
 * A soft halo that breathes behind the mic while it listens — a slow, low-opacity
 * swell that makes the button read as a live orb rather than a flat disc. It is
 * the calm base layer under the sharper expanding rings; the two together are the
 * modern voice-assistant look (Siri, Google Assistant).
 */
function Halo({ active, theme }: { active: boolean; theme: Theme }) {
  const [pulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      pulse.setValue(0);
    };
  }, [active, pulse]);

  if (!active) return null;
  const size = MIC_SIZE * 1.7;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: theme.color.brand,
        opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.22] }),
        transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) }],
      }}
    />
  );
}

/**
 * The rings breathing out from the mic while it listens — the near-universal
 * "I am hearing you" of a voice screen (Siri, Google Assistant, Meta AI). Three
 * staggered *outline* rings expand and fade on a loop: a thin stroke reads as
 * cleaner and more modern than a filling disc, and layered over the halo it
 * gives the surface real depth rather than a single blunt pulse.
 */
function PulseRings({ active, theme }: { active: boolean; theme: Theme }) {
  // Held in state (not a ref) so the render below may read them — the values are
  // created once by the lazy initialiser and never replaced, so this never
  // re-renders on its own.
  const [rings] = useState(() => [0, 1, 2].map(() => new Animated.Value(0)));

  useEffect(() => {
    if (!active) return;
    const loops = rings.map((value, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 700),
          Animated.timing(value, {
            toValue: 1,
            duration: 2100,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    loops.forEach((loop) => loop.start());
    return () => {
      loops.forEach((loop) => loop.stop());
      rings.forEach((value) => value.setValue(0));
    };
  }, [active, rings]);

  if (!active) return null;
  return (
    <>
      {rings.map((value, index) => (
        <Animated.View
          key={index}
          pointerEvents="none"
          style={{
            position: 'absolute',
            width: MIC_SIZE,
            height: MIC_SIZE,
            borderRadius: MIC_SIZE / 2,
            borderWidth: 2,
            borderColor: theme.color.brand,
            opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
            transform: [
              { scale: value.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) },
            ],
          }}
        />
      ))}
    </>
  );
}

/**
 * The resting breath: how long one half of it takes, how far it swells, and how
 * long it takes to let go.
 *
 * Slow and shallow on purpose. This is an invitation to tap, not a notification,
 * so there is no bounce, no jitter and no colour in it — a four-and-a-bit-percent
 * swell over two and a half seconds, which the eye reads as alive and never as
 * urgent.
 *
 * It is also deliberately a *different gesture* from listening, not a weaker one.
 * While the mic listens, the button holds perfectly still and the space around it
 * comes alive — the halo swells, rings break outward. At rest the opposite: the
 * button itself breathes and nothing surrounds it. Because the two states are
 * made of different parts, idle can never read as a half-broken listening.
 */
const IDLE_BREATH_MS = 2500;
const IDLE_BREATH_SCALE = 1.045;
const IDLE_SETTLE_MS = 320;

/**
 * The mic's breath while nobody is speaking, as a 0…1 driver.
 *
 * `active` is the entire gate, and every reason to be still goes through it: the
 * reduce-motion preference, a screen that is no longer in front, and a live
 * recogniser. Switching it off does not snap the button back to size — a jump at
 * the exact moment the mic opens reads as a glitch — it eases home over
 * {@link IDLE_SETTLE_MS}, so idle → listening → idle is one continuous gesture.
 *
 * Nothing outlives the effect: every path stops its own animation on the way out,
 * so a re-render, a blur, or a Fast Refresh cannot leave a loop running behind
 * the screen.
 */
function useIdleBreath(active: boolean): Animated.Value {
  const [breath] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!active) {
      const settle = Animated.timing(breath, {
        toValue: 0,
        duration: IDLE_SETTLE_MS,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      });
      settle.start();
      return () => settle.stop();
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: IDLE_BREATH_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: IDLE_BREATH_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, breath]);

  return breath;
}

/** The waveform's drawing box. Fixed and centred — the status area centres it. */
const WAVE_W = 300;
const WAVE_H = 72;

/**
 * The listening wave: filled, symmetric lobes mirrored about the centre line, the
 * shape a modern voice assistant draws while it hears you. Each layer is a closed
 * ribbon that swells into humps and pinches to a hairline between them, tapering
 * to a fine point at both ends; layered and blended over one pink→cyan gradient,
 * the overlaps build a bright core with crisp edges. Layers differ in wavelength
 * (`cycles`), phase, height (`amp`) and opacity so the humps sit in different
 * places and the wave reads as one living body, not a stack of copies. The last
 * layer is the hot white core.
 */
const WAVE_GRADIENT = 'url(#ecoWaveGrad)';

const WAVE_LAYERS = [
  { id: 'l0', fill: WAVE_GRADIENT, cycles: 1.1, phase: 0.0, amp: 0.62, opacity: 0.42 },
  { id: 'l1', fill: WAVE_GRADIENT, cycles: 1.7, phase: 0.9, amp: 0.82, opacity: 0.4 },
  { id: 'l2', fill: WAVE_GRADIENT, cycles: 1.0, phase: 1.9, amp: 1.0, opacity: 0.4 },
  { id: 'l3', fill: WAVE_GRADIENT, cycles: 2.1, phase: 2.7, amp: 0.72, opacity: 0.4 },
  { id: 'l4', fill: WAVE_GRADIENT, cycles: 1.5, phase: 3.6, amp: 0.9, opacity: 0.42 },
  // The hot core: a bright, low, tight ribbon on top, where a real voice UI's
  // centre burns near white.
  { id: 'core', fill: '#F0F9FF', cycles: 1.5, phase: 1.2, amp: 0.34, opacity: 0.9 },
] as const;

type WaveLayerSpec = (typeof WAVE_LAYERS)[number];

const AnimatedPath = Reanimated.createAnimatedComponent(Path);

/**
 * One layer's closed path for the current phase: the top edge left→right, then the
 * mirrored bottom edge right→left, closed into a filled ribbon. Symmetric about
 * the centre line, so it swells into centre-weighted humps and pinches to a
 * hairline between them, tapering to a point at both ends like the reference.
 * Runs on the UI thread — the body of a `useAnimatedProps` worklet.
 */
function wavePath(phase: number, level: number, layer: WaveLayerSpec): string {
  'worklet';
  const points = 72;
  const cy = WAVE_H / 2;
  const breath = 0.85 + 0.15 * Math.sin(phase * 2 + layer.phase);
  // Loudness drives the height: a quiet mic keeps a low idling ribbon (40%), a
  // loud voice pushes it to full. `level` is the eased 0…1 metering; when the
  // platform sends no volume events it stays 0 and the wave simply idles.
  const loud = 0.4 + 0.6 * level;
  const reach = (WAVE_H / 2 - 1) * layer.amp * breath * loud;
  let top = '';
  let bottom = '';
  for (let i = 0; i <= points; i++) {
    const frac = i / points;
    const x = (frac * WAVE_W).toFixed(2);
    const env = Math.exp(-Math.pow((frac - 0.5) / 0.34, 2));
    const hump = Math.abs(Math.sin(frac * layer.cycles * Math.PI * 2 + phase + layer.phase));
    // 0.05 keeps a hairline through the middle so the lobes read as one wave, not
    // a row of separate blobs; the rest is the swelling hump.
    const h = env * reach * (0.05 + 0.95 * hump);
    top += `${i === 0 ? 'M' : 'L'}${x} ${(cy - h).toFixed(2)} `;
    // Prepend the bottom edge so it reads right→left once appended after the top.
    bottom = `L${x} ${(cy + h).toFixed(2)} ${bottom}`;
  }
  return `${top}${bottom}Z`;
}

/** One translucent filled ribbon, its path recomputed each frame from `phase`
 *  and the live loudness `level`. */
function WaveLayer({
  phase,
  level,
  layer,
}: {
  phase: SharedValue<number>;
  level: SharedValue<number>;
  layer: WaveLayerSpec;
}) {
  const animatedProps = useAnimatedProps(() => ({ d: wavePath(phase.value, level.value, layer) }));
  return <AnimatedPath animatedProps={animatedProps} fill={layer.fill} opacity={layer.opacity} />;
}

/**
 * The live sound wave under the status while listening — filled, symmetric colour
 * lobes swelling and pinching across a bright core, the "I am hearing you" of a
 * modern voice screen. One shared phase drives every layer on the UI thread; the
 * layers differ in wavelength and phase so their humps sit in different places and
 * the wave reads as one living body. Only mounted while listening, so the loop is
 * torn down the moment it stops.
 */
function Waveform({ active, level }: { active: boolean; level: SharedValue<number> }) {
  const phase = useSharedValue(0);

  useEffect(() => {
    if (!active) return;
    phase.value = 0;
    // 0 → 2π on a loop. Both the hump term (|sin|, period π) and the breath
    // (sin of 2·phase) are seamless across the seam.
    phase.value = withRepeat(
      withTiming(Math.PI * 2, { duration: 2400, easing: ReEasing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(phase);
  }, [active, phase]);

  return (
    <Svg width={WAVE_W} height={WAVE_H}>
      <Defs>
        {/* Pink → fuchsia → violet → blue → cyan, left to right, so the whole
            wave carries the reference's horizontal hue shift no matter which
            layer a given lobe belongs to. */}
        <LinearGradient id="ecoWaveGrad" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#F472B6" />
          <Stop offset="0.28" stopColor="#C084FC" />
          <Stop offset="0.52" stopColor="#818CF8" />
          <Stop offset="0.74" stopColor="#38BDF8" />
          <Stop offset="1" stopColor="#22D3EE" />
        </LinearGradient>
      </Defs>
      {WAVE_LAYERS.map((layer) => (
        <WaveLayer key={layer.id} phase={phase} level={level} layer={layer} />
      ))}
    </Svg>
  );
}

/** What the capture knows about a finished sentence besides its text. */
export interface VoiceDoneInfo {
  /** True when it came from the live Deepgram stream, not the on-device recogniser. */
  readonly streamed: boolean;
  /** The engine's other hypotheses for it, best first (empty when it gave one). */
  readonly alternatives: readonly string[];
}

export interface VoiceCaptureProps {
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
}: VoiceCaptureProps) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const { t, locale } = useStrings();

  const [available] = useState(recognitionAvailable);
  const [listening, setListening] = useState(false);
  // The mic was asked to open and is on its way: shown at once as a calm
  // "Starting…" over an idling wave, so a tap answers within a frame, and it
  // turns into "Listening" only once audio is actually being captured. True from
  // the very first render when the panel opens the mic by itself.
  const [preparing, setPreparing] = useState(() => autoStart && recognitionAvailable());
  const [live, setLive] = useState('');
  // Which engine hears the mic. null until it is known (the entitlement may
  // still be loading); the start decides it and every start refreshes it.
  const [micEngine, setMicEngineState] = useState<VoiceEngineInfo | null>(null);
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
    setMicEngineState(info);
    onEngineRef.current?.(info);
  }, []);
  // How the live sentence ends, decided at the start (tap: silence; hold: release).
  const endRules = useRef<Pick<MicStartPlan, 'silenceMs' | 'firstWordMs'>>({
    silenceMs: null,
    firstWordMs: null,
  });
  const [error, setError] = useState<string | null>(null);
  // The error on show is a refused permission, so Settings is the cure and the
  // panel offers a button for it. Every other error is just text: tapping
  // "dictation failed" used to open Settings too, which fixed nothing.
  const [errorInSettings, setErrorInSettings] = useState(false);
  // The mic ran but heard nothing intelligible. Local to the panel — the screen
  // never saw a transcript to parse — and drives the same recovery copy a parsed
  // miss (`missed`) does, so "didn't catch that" and "didn't catch an amount"
  // read as one calm state rather than two different dead ends.
  const [emptyMiss, setEmptyMiss] = useState(false);

  // Live input loudness, 0…1, eased from the recogniser's volume events. The
  // waveform rides this so it answers the actual voice instead of looping on a
  // fixed clock; it stays 0 when the mic is shut.
  const level = useSharedValue(0);

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

  // Whether this screen is the one in front. The resting breath below must not
  // run behind another screen — an animation nobody can see is battery and
  // nothing else — and the panel is not always unmounted when it is left.
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  // The mic breathes only while it is genuinely waiting to be tapped: not while
  // it listens (that state has motion of its own), not behind another screen,
  // not on a build that has no microphone to offer, and never when the reader
  // has asked the OS for less motion.
  const breath = useIdleBreath(available && focused && !listening && !preparing && !reduceMotion);

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
    setLive(transcript);
  });

  // The recogniser's own metering (enabled via volumeChangeEventOptions in
  // start). `value` runs −2…10, where below 0 is inaudible; normalise to 0…1 and
  // ease so the wave tracks loudness without twitching on every packet.
  useSpeechRecognitionEvent('volumechange', (event) => {
    if (!speechMic.owns(session)) return;
    clearStall();
    const norm = Math.max(0, Math.min(1, event.value / 10));
    // `.set()`, not `.value =`: Reanimated 4's method API, the one the React
    // compiler allows off the UI thread (see PressableScale in lib/anim).
    level.set(withTiming(norm, { duration: 90 }));
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
    if (message) {
      setError(message);
      setErrorInSettings(isPermissionError(event.error));
    }
    setListening(false);
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
    setListening(false);
    level.set(withTiming(0, { duration: 150 }));
    const said = latest.current.trim();
    if (said) onDone(said, { streamed: false, alternatives: latestAlternatives.current });
    // Heard nothing usable — surface the same calm recovery a parsed miss shows,
    // rather than silently dropping back to the opening prompt as if nothing had
    // been tried, and record why so a silent-mic device can be diagnosed.
    else setEmptyMiss(true);
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
    setListening(false);
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
      onDone(said, { streamed: true, alternatives: live.alternatives() });
    } else setEmptyMiss(true);
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
        setLive(text);
        const { silenceMs } = endRules.current;
        if (changed && text.trim() && silenceMs !== null) armSilence(silenceMs);
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
          setListening(false);
          level.set(withTiming(0, { duration: 150 }));
          speechMic.release(session);
          if (said) onDone(said, { streamed: true, alternatives });
          else {
            setError(t.misc.dictationFailed);
            setErrorInSettings(false);
          }
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
      setListening(true);
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
      setError(null);
      setErrorInSettings(false);
      // Speaking again is the retry: clear both miss states as the mic opens, and
      // let the screen drop any parsed miss it is still holding.
      setEmptyMiss(false);
      onListen?.();
      latest.current = '';
      latestAlternatives.current = [];
      setLive('');
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
        setError(t.misc.dictationFailed);
        setErrorInSettings(false);
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
        setError(permission.canAskAgain ? t.misc.micPermission : t.misc.micBlocked);
        // Settings is the cure only once the system stops asking; while it can
        // still ask, tapping the mic again brings the prompt back.
        setErrorInSettings(!permission.canAskAgain);
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
        capture.current = await startCapture({
          onLevel: (value) => level.set(withTiming(value, { duration: 90 })),
        });
        mark('recorder started');
        if (!mounted.current) {
          await dropCapture();
          return give();
        }
        // "Listening" only when this recording is the one that will be heard.
        // While the entitlement is still unknown it may yet be dropped for the
        // on-device recogniser, so the panel stays on "Starting…" until then.
        if (capture.current && streamLiveRef.current) setListening(true);
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
        setListening(false);
        level.set(0);
      }
      if (!mounted.current) return give();
      // A push-to-talk cancel that landed while the token was in flight.
      const endedEarly = pendingEnd.current as 'send' | 'cancel' | null;
      if (endedEarly === 'cancel') {
        pendingEnd.current = null;
        setListening(false);
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
          // listening for at least a few seconds, and do not treat a two-second
          // pause as the end of speech. (Android-only extras; iOS endpointing is
          // already more forgiving and ignores these.)
          androidIntentOptions: {
            EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 4000,
            EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 2000,
            EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 2000,
          },
        });
        speechMic.opened(session);
        mark('recogniser started');
        setListening(true);
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
            setListening(false);
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
          setListening(false);
          level.set(withTiming(0, { duration: 150 }));
          setError(t.misc.dictationFailed);
          setErrorInSettings(false);
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
            setListening(false);
            level.set(withTiming(0, { duration: 150 }));
            const said = latest.current.trim();
            if (said) onDone(said, { streamed: false, alternatives: latestAlternatives.current });
            else setEmptyMiss(true);
            speechMic.release(session);
          }, HARD_STOP_MS);
        }, MAX_LISTEN_MS);
      } catch {
        setListening(false);
        setError(t.misc.dictationFailed);
        setErrorInSettings(false);
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
      setPreparing(true);
      try {
        await openMic(forceNetwork);
      } finally {
        if (mounted.current) setPreparing(false);
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

  if (!available) {
    return (
      <Text tone="muted" align="center">
        {t.voice.unavailable}
      </Text>
    );
  }

  // The recovery state, once, whatever caused it: an utterance that carried no
  // amount (`missed`, parsed by the screen) or one that carried no words at all
  // (`emptyMiss`, seen here). Only while the mic is at rest — a new try clears it.
  const showMiss = !listening && (missed || emptyMiss);
  const missHeadline = missed ? t.voice.noAmount : t.voice.missedNothing;

  // The on-device setup offer, in one place instead of two.
  //
  // It used to be drawn twice — once crammed under the worked example at rest,
  // once after a miss the network engine caused — and the first of those put a
  // one-off piece of housekeeping in the middle of the capture surface, a line
  // under the sentence somebody is being invited to speak. The *when* is
  // unchanged (this is exactly the union of the two old conditions); only the
  // *where* moved, to the foot of the panel, where an aside belongs.
  const offerOffline =
    (!listening && !showMiss && !live && offlineEligible) ||
    (showMiss && (engine === 'network' || offlineEligible));

  return (
    // `flexGrow` (never `flex`) so the panel fills a tall screen — letting the
    // offer below settle on the bottom edge — without being squeezed on a short
    // one, where the screen scrolls instead. See the matching note on the route's
    // scroll container.
    <View style={{ flexGrow: 1, alignItems: 'center', gap: theme.spacing.lg }}>
      {/* One headline, whatever most needs saying: the sentence forming while
          listening, a calm recovery line after a miss, or the opening prompt at
          rest. Never a warning stacked on top of it. */}
      <Text variant="title" align="center">
        {showMiss ? missHeadline : live || t.voice.prompt}
      </Text>

      {/* The mic sits inside a fixed square so the pulse rings expanding behind it
          never shove the layout around as they grow. */}
      <View
        style={{
          width: MIC_SIZE * 2.1,
          height: MIC_SIZE * 2.1,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Halo active={listening && !reduceMotion} theme={theme} />
        <PulseRings active={listening && !reduceMotion} theme={theme} />
        {/* The resting breath scales the button and only the button. It lives
            inside the fixed square, so the swell never moves a single thing
            around it — and it is a wrapper rather than a style on the Pressable
            so the press feedback and the breath cannot overwrite each other. */}
        <Animated.View
          style={{
            transform: [
              {
                scale: breath.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, IDLE_BREATH_SCALE],
                }),
              },
            ],
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              listening ? t.misc.stopDictating : showMiss ? t.voice.tapToRetry : t.voice.tapToSpeak
            }
            accessibilityState={{ busy: listening }}
            onPress={toggle}
            hitSlop={8}
            style={({ pressed }) => ({
              width: MIC_SIZE,
              height: MIC_SIZE,
              borderRadius: MIC_SIZE / 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.buttonPrimary,
              opacity: pressed ? 0.9 : 1,
              // A soft glow lifts the black mic off the surface while it is live.
              ...(listening
                ? {
                    shadowColor: theme.color.buttonPrimary,
                    shadowOpacity: 0.45,
                    shadowRadius: 20,
                    shadowOffset: { width: 0, height: 6 },
                    elevation: 10,
                  }
                : null),
            })}
          >
            <Ionicons
              name={listening ? 'stop' : 'mic'}
              size={iconSize.xxl}
              color={theme.color.onButtonPrimary}
            />
          </Pressable>
        </Animated.View>
      </View>

      {/* Listening: the status word over a live waveform. Recovering: the title
          already says what was missed, so the mic just invites the tap — no
          second warning under it. At rest: a worked example under the prompt.
          The miss is stated once (the title), never a warning stacked on a
          warning. */}
      <View style={{ alignItems: 'center', gap: theme.spacing.md }}>
        {/* The line that says "Tap to speak" is a thing to tap. It was copy and
            nothing else, which meant the most literal reading of the screen —
            tap the words telling you to tap — did nothing at all. It runs the
            same `toggle` the mic runs, so it can never drift out of step with
            it: whatever the mic would do in this state, this does.

            Deliberately not a second entry in the accessibility tree. The mic
            two rows up is already a button carrying this exact label — the same
            expression, character for character — and this exact action, so a
            screen reader that meets the same command twice in a row has learned
            nothing the second time. This is that control's own copy, widened
            into a target for the eye and the thumb.

            It takes all three props, and `accessible={false}` is the one doing
            the work on iOS. A `Pressable` defaults to `accessible`, which makes
            it an accessibility *element* — and `accessibilityElementsHidden`
            hides what an element contains, not the element itself, so on its own
            it would have left VoiceOver announcing this button after the mic's.
            (Everywhere else in the app this pair sits on a plain `View`, which
            is not an element, which is why two props are enough there.)
            `importantForAccessibility` is the Android half. */}
        <Pressable
          onPress={toggle}
          hitSlop={8}
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Text tone={listening || preparing || showMiss ? 'brand' : 'muted'}>
            {listening
              ? t.misc.listening
              : preparing
                ? t.misc.micStarting
                : showMiss
                  ? t.voice.tapToRetry
                  : t.voice.tapToSpeak}
          </Text>
        </Pressable>
        {/* While the mic is opening the wave is already there, idling low (no
            level yet), so the tap is answered at once; it rides the real
            loudness from the moment audio arrives. */}
        {(listening || preparing) && !reduceMotion ? (
          <Waveform active={listening || preparing} level={level} />
        ) : null}
        <VoiceEngineBadge info={micEngine} />
      </View>

      {/* Things to say, under the wave: three sentences that each show one
          thing the parser understands — a named group, the people to split
          with, and "just for me" for the personal ledger. Gone once words are
          arriving, when the sentence forming in the headline is the thing to
          read. */}
      {live ? null : <TrySaying t={t} theme={theme} groupNames={groupNames} />}

      {error ? (
        <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
          <Text variant="caption" tone="negative" align="center">
            {error}
          </Text>
          {errorInSettings ? (
            <Button
              label={t.pickers.openSettings}
              size="sm"
              variant="secondary"
              onPress={() => void Linking.openSettings()}
            />
          ) : null}
        </View>
      ) : null}

      {/* The panel's footer: the on-device setup offer, at the foot of the screen.
          Either it is the standing offer (on-device is supported here but the
          English model is not installed) or it is the way out of a miss the
          network engine caused — when that recogniser hears audio and returns
          nothing, it is broken on this device and the on-device model is the only
          path that works.

          `marginTop: 'auto'` is what carries it down: the panel grows to the
          window, so the free space collects above this block instead of below it.
          The padding above is its own breathing room, and the room below it comes
          from the route's `clearance` — the system navigation bar's inset plus a
          breath — applied once, on the scroll container. */}
      {offerOffline ? (
        <View
          style={{
            marginTop: 'auto',
            paddingTop: theme.spacing.xxl,
            alignItems: 'center',
            gap: theme.spacing.xs,
          }}
        >
          <Pressable
            accessibilityRole="button"
            disabled={downloading}
            accessibilityState={{ disabled: downloading }}
            onPress={() => void setupOffline()}
            hitSlop={8}
            style={({ pressed }) => ({ opacity: downloading ? 0.5 : pressed ? 0.6 : 1 })}
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
    </View>
  );
}

/** The "Try saying…" card: a heading and three example sentences, each with a
 *  glyph for what it is about. Read-only — the mic is the way in.
 *
 *  The sentences are drawn fresh each time the screen opens, fitted to the
 *  phone's country and to the reader's own groups (`lib/voiceExamples`). The
 *  seed is held for the life of the panel, so the place and the names stay put
 *  while somebody reads them; when the group list finishes loading, only the
 *  group line changes, to one of their real groups. */
function TrySaying({
  t,
  theme,
  groupNames,
}: {
  t: ReturnType<typeof useStrings>['t'];
  theme: Theme;
  groupNames: readonly string[];
}) {
  const currency = useDefaultCurrency();
  const [seed] = useState(() => Math.floor(Math.random() * 2147483646) + 1);
  const groupsKey = groupNames.join('\u0000');
  const example = useMemo(
    () => voiceExamples(exampleCountry(currency, deviceCountry()), groupNames, seededRandom(seed)),
    // Keyed on the names themselves, not the array's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groupsKey, seed, currency],
  );
  const group = example.group ?? fill(t.voice.tripName, { place: example.place });
  const rows: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
    { icon: 'cart-outline', text: fill(t.voice.tryGroup, { amount: example.groceries, group }) },
    {
      icon: 'restaurant-outline',
      text: fill(t.voice.trySplit, {
        amount: example.dinner,
        a: example.names[0],
        b: example.names[1],
      }),
    },
    { icon: 'cafe-outline', text: fill(t.voice.tryJustMe, { amount: example.coffee }) },
  ];
  return (
    <View
      style={{
        alignSelf: 'stretch',
        gap: theme.spacing.sm,
        padding: theme.spacing.md,
        borderRadius: theme.radius.xl,
        backgroundColor:
          theme.scheme === 'dark' ? 'rgba(28, 26, 44, 0.78)' : 'rgba(255, 255, 255, 0.72)',
        borderWidth: 1,
        borderColor:
          theme.scheme === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.9)',
      }}
    >
      <Text variant="caption" tone="muted">
        {t.voice.trySaying}
      </Text>
      {rows.map((row) => (
        <View
          key={row.icon}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.md,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm + 2,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.color.brandSoft,
          }}
        >
          <Ionicons name={row.icon} size={iconSize.md} color={theme.color.brand} />
          <Text variant="body" style={{ flex: 1 }}>
            {row.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** A small seeded generator (Park–Miller), so one draw stays one draw. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}
