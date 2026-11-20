/**
 * The recogniser behind a held mic: starts when mounted, streams the words as
 * they arrive, and ends on `finish` (send) or unmount (cancel). Reached only
 * through `HoldVoiceHost`'s guarded require, like `VoiceCapture`.
 */

import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

import { useStrings } from '@/i18n';
import { speechLocale } from '@/lib/dictation';
import { speechMic } from '@/lib/speechMic';
import { androidSpeechService } from '@/lib/speechService';
import { shouldRetryWithDefault } from '@/lib/speechServicePure';
import { VoiceClip } from '@/lib/voiceTelemetry';
import { STREAM_MAX_SESSION_MS } from '@/lib/voiceEnginePure';
import { VOICE_DIAG_ENABLED, type VoiceDiag } from '@/lib/voiceDiagPure';
import {
  attachStream,
  batchTranscription,
  checkOnline,
  getStreamSession,
  micIsLive,
  startCapture,
  streamingAvailable,
  type LiveTranscription,
} from '@/lib/voiceStream';
import { batchAfterAttachFailure } from '@/lib/voiceStreamPure';

speechMic.attach({
  stop: () => ExpoSpeechRecognitionModule.stop(),
  abort: () => ExpoSpeechRecognitionModule.abort(),
});

export interface HoldRecorderProps {
  /** Becomes true when the finger lifts: finish the sentence now. */
  finish: boolean;
  hints?: readonly string[];
  /**
   * Stream to the cloud recogniser, as the voice screen does for Pro (the relay
   * takes the group's names as keyterms), for everyone signed in. Offline or no
   * permission uses the phone's recogniser from the start. A socket that will not
   * attach never drops the audio: the recorder keeps going and, when `batch` is
   * allowed (Pro), the whole clip is transcribed on the server when the finger lifts.
   */
  cloud?: { groupId: string | null; personal?: boolean; today: string; batch: boolean } | null;
  /** Input loudness 0…1 from the first audio frame, so the pill shows it is hearing. */
  onLevel?: (level: number) => void;
  /** Preview/dev builds only: how the engine got going. */
  onDiag?: (diag: VoiceDiag) => void;
  onWords: (words: string) => void;
  /** The recogniser has ended; `words` is everything heard ('' if nothing). */
  onDone: (words: string, alternatives: readonly string[]) => void;
}

export function HoldRecorder({
  finish,
  hints,
  cloud,
  onLevel,
  onDiag,
  onWords,
  onDone,
}: HoldRecorderProps) {
  const { language, locale } = useStrings();
  const [session] = useState(() => Symbol('hold'));
  const heard = useRef('');
  const alternatives = useRef<readonly string[]>([]);
  const live = useRef(true);
  const opened = useRef(false);
  const stream = useRef<LiveTranscription | null>(null);
  const cap = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cloudRef = useRef(cloud);
  const done = useRef(onDone);
  const levelRef = useRef(onLevel);
  const diagRef = useRef(onDiag);
  const [pressed] = useState(() => Date.now());
  const diag = useRef<VoiceDiag>({
    engine: 'phone',
    firstFrameMs: null,
    attachMs: null,
    attachFailed: null,
    chars: null,
  });
  const [clip] = useState(() => new VoiceClip());
  // Phone recogniser state: the service in use, whether the one default-service
  // retry is spent, a retry waiting on the failed session's `end`, restarts after a
  // pause while the finger is down, and the words from sessions before this one.
  const usedPkg = useRef<string | undefined>(undefined);
  const serviceRetried = useRef(false);
  const retryPending = useRef(false);
  const restarts = useRef(0);
  const prefix = useRef('');
  const report = (patch: Partial<VoiceDiag>): void => {
    if (patch.engine) clip.setEngine(patch.engine, usedPkg.current);
    if (!VOICE_DIAG_ENABLED) return;
    diag.current = { ...diag.current, ...patch };
    diagRef.current?.(diag.current);
  };
  const end = (words: string, alts: readonly string[]): void => {
    report({ chars: words.length });
    clip.send();
    done.current(words, alts);
  };
  const finishRef = useRef(finish);
  useEffect(() => {
    done.current = onDone;
    levelRef.current = onLevel;
    diagRef.current = onDiag;
    finishRef.current = finish;
  });

  // Lifted (or the cap hit) on a live stream: flush it and hand over what it heard.
  const finishStream = async (): Promise<void> => {
    const open = stream.current;
    if (!open) return;
    stream.current = null;
    const alternatives = open.alternatives();
    const said = (await open.stop()).trim() || heard.current;
    speechMic.release(session);
    if (live.current) end(said, alternatives);
  };
  const finishStreamRef = useRef(finishStream);
  useEffect(() => {
    finishStreamRef.current = finishStream;
  });

  /** True when the stream took the hold (or the hold ended meanwhile); false: use the phone. */
  const startStream = async (): Promise<boolean> => {
    const request = cloudRef.current;
    if (!request || !streamingAvailable()) return false;
    try {
      const permission = await ExpoSpeechRecognitionModule.getPermissionsAsync();
      if (!permission.granted) return false;
      // The mic starts now, with the online check alongside: no word waits on the network.
      const [mic, online] = await Promise.all([
        startCapture({
          onLevel: (level) => {
            if (diag.current.firstFrameMs === null) {
              report({ firstFrameMs: Date.now() - pressed });
            }
            levelRef.current?.(level);
          },
        }),
        checkOnline(),
      ]);
      if (!mic) return false;
      if (!online) {
        await mic.discard();
        return false;
      }
      const got = live.current
        ? await getStreamSession({ groupId: request.groupId, locale })
        : null;
      const attached =
        got?.kind === 'ok' && live.current
          ? await attachStream(mic, got.session, {
              onInterim: (text) => {
                heard.current = text;
                clip.words(text);
                onWords(text);
              },
              onFinal: (text) => {
                heard.current = text;
                clip.words(text);
                onWords(text);
              },
              // Died mid-sentence: keep the words so far.
              onError: () => {
                stream.current = null;
                speechMic.release(session);
                if (live.current) end(heard.current, []);
              },
            })
          : null;
      if (attached?.kind !== 'ok') {
        if (!live.current) {
          await mic.discard();
          return true;
        }
        const failure = attached?.kind ?? got?.kind ?? 'error';
        report({ attachFailed: failure === 'quota' ? 'allowance used' : 'no connection' });
        if (
          request.batch &&
          batchAfterAttachFailure(failure === 'quota' ? 'quota' : 'error', micIsLive(mic))
        ) {
          // Never lose the audio: keep recording, transcribe the clip on lift.
          report({ engine: 'cloud-batch' });
          stream.current = batchTranscription(mic, {
            groupId: request.groupId,
            personal: request.personal,
            locale,
            today: request.today,
          });
          cap.current = setTimeout(() => void finishStreamRef.current(), STREAM_MAX_SESSION_MS);
          if (finishRef.current) void finishStream();
          return true;
        }
        await mic.discard();
        return false;
      }
      if (!live.current) {
        attached.live.cancel();
        return true;
      }
      report({ engine: 'cloud-stream', attachMs: Date.now() - pressed });
      stream.current = attached.live;
      // A stream that never finishes (the finger stuck) ends at the relay's cap.
      cap.current = setTimeout(() => void finishStreamRef.current(), STREAM_MAX_SESSION_MS);
      if (finishRef.current) void finishStream();
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Open the phone recogniser (the first time, a default-service retry, or a
   * restart after a pause). Android is not `continuous`: continuous makes the
   * library record and pipe the audio itself on Android 13+, which hurts quality;
   * a pause that ends the session while the finger is still down restarts it once.
   */
  const beginPhone = async (pkg: string | undefined): Promise<void> => {
    try {
      if (opened.current && !(await speechMic.acquire(session))) {
        end(heard.current, alternatives.current);
        return;
      }
      if (!live.current) {
        speechMic.release(session);
        return;
      }
      ExpoSpeechRecognitionModule.start({
        lang: speechLocale(language, locale),
        interimResults: true,
        maxAlternatives: 5,
        continuous: Platform.OS !== 'android',
        contextualStrings: hints && hints.length > 0 ? [...hints] : undefined,
        iosTaskHint: 'dictation',
        androidRecognitionServicePackage: pkg,
      });
      speechMic.opened(session);
      opened.current = true;
      // Lifted while the recogniser was still opening: finish it now.
      if (finishRef.current) speechMic.stop(session);
    } catch {
      speechMic.release(session);
      end('', []);
    }
  };

  useSpeechRecognitionEvent('result', (event) => {
    if (!speechMic.owns(session)) return;
    const said = event.results[0]?.transcript;
    heard.current = said ? (prefix.current ? `${prefix.current} ${said}` : said) : heard.current;
    alternatives.current = event.results.map((r) => r.transcript);
    clip.words(heard.current);
    onWords(heard.current);
  });
  useSpeechRecognitionEvent('error', (event) => {
    if (!speechMic.owns(session)) return;
    clip.fail(event.error);
    // The chosen service would not take the session: once, on the phone's default.
    if (
      !heard.current &&
      shouldRetryWithDefault(event.error, usedPkg.current, serviceRetried.current)
    ) {
      serviceRetried.current = true;
      retryPending.current = true;
      usedPkg.current = undefined;
    }
    speechMic.errored(session);
  });
  useSpeechRecognitionEvent('end', () => {
    if (!speechMic.ended(session)) return;
    if (live.current && retryPending.current) {
      retryPending.current = false;
      clip.setEngine('phone', undefined);
      void beginPhone(undefined);
      return;
    }
    // A pause ended the (non-continuous) Android session with the finger still down.
    if (
      live.current &&
      Platform.OS === 'android' &&
      !finishRef.current &&
      restarts.current < 1 &&
      heard.current
    ) {
      restarts.current += 1;
      prefix.current = heard.current;
      void beginPhone(usedPkg.current);
      return;
    }
    if (live.current) end(heard.current, alternatives.current);
  });

  useEffect(() => {
    live.current = true;
    void (async () => {
      if (!(await speechMic.acquire(session))) {
        // The previous recogniser is still stopping: end this hold cleanly
        // rather than leave the pill up with nothing listening.
        if (live.current) end('', []);
        return;
      }
      if (!live.current) {
        speechMic.release(session);
        return;
      }
      if (await startStream()) return;
      if (!live.current) {
        speechMic.release(session);
        return;
      }
      usedPkg.current = androidSpeechService();
      report({ engine: 'phone', firstFrameMs: Date.now() - pressed, service: usedPkg.current });
      await beginPhone(usedPkg.current);
    })();
    return () => {
      live.current = false;
      if (cap.current) clearTimeout(cap.current);
      stream.current?.cancel();
      stream.current = null;
      speechMic.release(session);
    };
    // One recording per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (finish && opened.current) speechMic.stop(session);
    if (finish) void finishStreamRef.current();
  }, [finish, session]);

  return null;
}
