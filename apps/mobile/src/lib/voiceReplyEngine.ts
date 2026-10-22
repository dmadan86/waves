/**
 * The device half of answering a follow-up by voice: one short clip, heard on
 * the app's existing voice stack and handed back as text.
 *
 * It reuses what the mic screen uses — the buffering recorder and the
 * `voice-stream` relay to Deepgram (`voiceStream`), and the phone's own
 * recogniser when the relay will not open (offline mid-press, no Pro, over the
 * monthly stream allowance) — so a reply never adds a second capture path.
 * The clip ends on its own: a pause after the last new word, no speech at all,
 * or {@link REPLY_MAX_MS}. Native modules load lazily; a build without them
 * reads as "unsupported", never a crash. Nothing here throws into the UI.
 */

import { Platform } from 'react-native';

import { englishSpeechLocale, isPermissionError } from '@/lib/dictation';
import {
  attachStream,
  getStreamSession,
  startCapture,
  streamingAvailable,
  type LiveTranscription,
} from '@/lib/voiceStream';
import { remainingFrom } from '@/lib/voiceStreamPure';
import { REPLY_FIRST_WORD_MS, REPLY_MAX_MS, REPLY_SILENCE_MS } from '@/lib/voiceReplyPure';

export type ReplyOutcome =
  { kind: 'text'; text: string } | { kind: 'empty' } | { kind: 'denied' } | { kind: 'failed' };

export interface ReplyHandlers {
  /** Words heard so far, while the clip is still open. */
  onText?: (text: string) => void;
  /** The mic is closed; the words are being finalised. */
  onCaptured: () => void;
  /** Exactly once, unless the run was cancelled. */
  onEnd: (outcome: ReplyOutcome) => void;
}

export interface ReplyRun {
  /** End the clip now and deliver what was heard. */
  stop: () => void;
  /** Drop everything, free the mic, deliver nothing. */
  cancel: () => void;
}

export interface ReplyContext {
  groupId: string | null;
  /** The app locale; speech is recognised in English. */
  locale: string;
}

export interface ReplyEngine {
  supported: () => boolean;
  start: (context: ReplyContext, handlers: ReplyHandlers) => ReplyRun;
}

type SpeechModule = typeof import('expo-speech-recognition').ExpoSpeechRecognitionModule;

function loadSpeech(): SpeechModule | null {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('expo-speech-recognition') as {
      ExpoSpeechRecognitionModule: SpeechModule;
    };
    return loaded.ExpoSpeechRecognitionModule ?? null;
  } catch {
    return null;
  }
}

async function micAllowed(speech: SpeechModule | null): Promise<boolean> {
  if (!speech) return false;
  try {
    if ((await speech.getPermissionsAsync()).granted) return true;
    return (await speech.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Real engine: relay stream first, the phone's recogniser if that will not open. */
export const deviceReplyEngine: ReplyEngine = {
  supported: () => streamingAvailable() || loadSpeech() !== null,

  start(context, handlers) {
    let cancelled = false;
    let ended = false;
    let stopAsked = false;
    let endNow: () => void = () => {};
    let teardown: () => void = () => {};

    const deliver = (outcome: ReplyOutcome): void => {
      if (ended || cancelled) return;
      ended = true;
      handlers.onEnd(outcome);
    };

    const viaPhone = (speech: SpeechModule): void => {
      let best = '';
      const subs: { remove: () => void }[] = [];
      const timer = setTimeout(() => endNow(), REPLY_MAX_MS);
      const release = (): void => {
        clearTimeout(timer);
        for (const sub of subs) sub.remove();
        subs.length = 0;
      };
      const finish = (outcome: ReplyOutcome): void => {
        release();
        deliver(outcome);
      };
      endNow = () => {
        handlers.onCaptured();
        try {
          speech.stop();
        } catch {
          finish(best ? { kind: 'text', text: best } : { kind: 'empty' });
        }
      };
      teardown = () => {
        release();
        try {
          speech.abort();
        } catch {
          // Nothing running.
        }
      };
      subs.push(
        speech.addListener('result', (event) => {
          const text = event.results[0]?.transcript?.trim() ?? '';
          if (text) {
            best = text;
            handlers.onText?.(text);
          }
        }),
        speech.addListener('error', (event) => {
          if (isPermissionError(event.error)) finish({ kind: 'denied' });
          else if (event.error === 'no-speech' || event.error === 'speech-timeout') {
            finish(best ? { kind: 'text', text: best } : { kind: 'empty' });
          } else finish(best ? { kind: 'text', text: best } : { kind: 'failed' });
        }),
        speech.addListener('end', () => {
          handlers.onCaptured();
          finish(best ? { kind: 'text', text: best } : { kind: 'empty' });
        }),
      );
      try {
        speech.start({
          lang: englishSpeechLocale(context.locale),
          interimResults: true,
          continuous: false,
          maxAlternatives: 1,
          iosTaskHint: 'dictation',
          androidIntentOptions: {
            EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: REPLY_SILENCE_MS,
            EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: REPLY_SILENCE_MS,
          },
        });
      } catch {
        finish({ kind: 'failed' });
      }
    };

    /** The relay stream; false when it could not be opened (the phone takes over). */
    const viaStream = async (): Promise<boolean> => {
      if (!streamingAvailable()) return false;
      const mic = await startCapture();
      if (!mic) return false;
      if (cancelled) {
        await mic.discard();
        return true;
      }
      const got = await getStreamSession({ groupId: context.groupId, locale: context.locale });
      if (cancelled || got.kind !== 'ok') {
        await mic.discard();
        return cancelled;
      }
      let latest = '';
      let live: LiveTranscription | null = null;
      let silence: ReturnType<typeof setTimeout> | null = null;
      let max: ReturnType<typeof setTimeout> | null = null;
      const clearTimers = (): void => {
        if (silence) clearTimeout(silence);
        if (max) clearTimeout(max);
        silence = max = null;
      };
      const arm = (ms: number): void => {
        if (silence) clearTimeout(silence);
        silence = setTimeout(() => endNow(), ms);
      };
      const hear = (text: string): void => {
        const changed = text.trim() !== latest.trim();
        latest = text;
        handlers.onText?.(text);
        // Deepgram repeats the finished sentence in a quiet room; only new words
        // restart the pause clock.
        if (changed && text.trim()) arm(REPLY_SILENCE_MS);
      };
      const attached = await attachStream(mic, got.session, {
        onInterim: hear,
        onFinal: hear,
        onError: () => {
          clearTimers();
          deliver(latest.trim() ? { kind: 'text', text: latest.trim() } : { kind: 'failed' });
        },
      });
      if (attached.kind !== 'ok' || cancelled) {
        if (attached.kind === 'ok') attached.live.cancel();
        else await mic.discard();
        return cancelled;
      }
      live = attached.live;
      const now = Date.now();
      arm(remainingFrom(mic.startedAt, now, REPLY_FIRST_WORD_MS, 500));
      max = setTimeout(() => endNow(), remainingFrom(mic.startedAt, now, REPLY_MAX_MS, 500));
      endNow = () => {
        if (ended) return;
        clearTimers();
        handlers.onCaptured();
        const stream = live;
        void (stream ? stream.stop() : Promise.resolve(latest)).then(
          (text) => deliver(text.trim() ? { kind: 'text', text: text.trim() } : { kind: 'empty' }),
          () => deliver({ kind: 'failed' }),
        );
      };
      teardown = () => {
        clearTimers();
        live?.cancel();
      };
      return true;
    };

    void (async () => {
      const speech = loadSpeech();
      if (!(await micAllowed(speech))) return deliver({ kind: 'denied' });
      if (cancelled) return;
      if (!(await viaStream())) {
        if (cancelled) return;
        if (!speech) return deliver({ kind: 'failed' });
        viaPhone(speech);
      }
      // A stop that came while the mic was still opening.
      if (stopAsked && !cancelled) endNow();
    })();

    return {
      stop: () => {
        stopAsked = true;
        endNow();
      },
      cancel: () => {
        if (cancelled) return;
        cancelled = true;
        teardown();
      },
    };
  },
};
