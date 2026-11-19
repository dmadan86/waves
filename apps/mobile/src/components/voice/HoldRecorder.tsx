/**
 * The recogniser behind a held mic: starts when mounted, streams the words as
 * they arrive, and ends on `finish` (send) or unmount (cancel). Reached only
 * through `HoldVoiceHost`'s guarded require, like `VoiceCapture`.
 */

import { useEffect, useRef, useState } from 'react';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

import { useStrings } from '@/i18n';
import { speechLocale } from '@/lib/dictation';
import { speechMic } from '@/lib/speechMic';

speechMic.attach({
  stop: () => ExpoSpeechRecognitionModule.stop(),
  abort: () => ExpoSpeechRecognitionModule.abort(),
});

export interface HoldRecorderProps {
  /** Becomes true when the finger lifts: finish the sentence now. */
  finish: boolean;
  hints?: readonly string[];
  onWords: (words: string) => void;
  /** The recogniser has ended; `words` is everything heard ('' if nothing). */
  onDone: (words: string, alternatives: readonly string[]) => void;
}

export function HoldRecorder({ finish, hints, onWords, onDone }: HoldRecorderProps) {
  const { language, locale } = useStrings();
  const [session] = useState(() => Symbol('hold'));
  const heard = useRef('');
  const alternatives = useRef<readonly string[]>([]);
  const live = useRef(true);
  const opened = useRef(false);
  const done = useRef(onDone);
  const finishRef = useRef(finish);
  useEffect(() => {
    done.current = onDone;
    finishRef.current = finish;
  });

  useSpeechRecognitionEvent('result', (event) => {
    if (!speechMic.owns(session)) return;
    heard.current = event.results[0]?.transcript ?? heard.current;
    alternatives.current = event.results.map((r) => r.transcript);
    onWords(heard.current);
  });
  useSpeechRecognitionEvent('error', () => {
    if (speechMic.owns(session)) speechMic.errored(session);
  });
  useSpeechRecognitionEvent('end', () => {
    if (!speechMic.ended(session)) return;
    if (live.current) done.current(heard.current, alternatives.current);
  });

  useEffect(() => {
    live.current = true;
    void (async () => {
      if (!(await speechMic.acquire(session))) {
        // The previous recogniser is still stopping: end this hold cleanly
        // rather than leave the pill up with nothing listening.
        if (live.current) done.current('', []);
        return;
      }
      if (!live.current) {
        speechMic.release(session);
        return;
      }
      try {
        ExpoSpeechRecognitionModule.start({
          lang: speechLocale(language, locale),
          interimResults: true,
          maxAlternatives: 5,
          continuous: true,
          contextualStrings: hints && hints.length > 0 ? [...hints] : undefined,
          iosTaskHint: 'dictation',
        });
        speechMic.opened(session);
        opened.current = true;
        // Lifted while the recogniser was still opening: finish it now.
        if (finishRef.current) speechMic.stop(session);
      } catch {
        speechMic.release(session);
        done.current('', []);
      }
    })();
    return () => {
      live.current = false;
      speechMic.release(session);
    };
    // One recording per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (finish && opened.current) speechMic.stop(session);
  }, [finish, session]);

  return null;
}
