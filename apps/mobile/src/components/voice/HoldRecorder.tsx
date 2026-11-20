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
import { STREAM_MAX_SESSION_MS } from '@/lib/voiceEnginePure';
import {
  attachStream,
  checkOnline,
  getStreamSession,
  startCapture,
  streamingAvailable,
  type LiveTranscription,
} from '@/lib/voiceStream';

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
   * takes the group's names as keyterms). Anything that goes wrong on the way
   * in — no permission yet, offline, the monthly allowance, a refused or slow
   * socket — quietly uses the phone's recogniser instead.
   */
  cloud?: { groupId: string | null } | null;
  onWords: (words: string) => void;
  /** The recogniser has ended; `words` is everything heard ('' if nothing). */
  onDone: (words: string, alternatives: readonly string[]) => void;
}

export function HoldRecorder({ finish, hints, cloud, onWords, onDone }: HoldRecorderProps) {
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
  const finishRef = useRef(finish);
  useEffect(() => {
    done.current = onDone;
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
    if (live.current) done.current(said, alternatives);
  };
  const finishStreamRef = useRef(finishStream);
  useEffect(() => {
    finishStreamRef.current = finishStream;
  });

  /** True when the stream took the hold (or the hold ended meanwhile); false: use the phone. */
  const startStream = async (): Promise<boolean> => {
    if (!cloudRef.current || !streamingAvailable()) return false;
    try {
      const permission = await ExpoSpeechRecognitionModule.getPermissionsAsync();
      if (!permission.granted || !(await checkOnline())) return false;
      const mic = await startCapture();
      if (!mic) return false;
      const got = live.current
        ? await getStreamSession({ groupId: cloudRef.current.groupId, locale })
        : null;
      const attached = got?.kind === 'ok' && live.current
        ? await attachStream(mic, got.session, {
            onInterim: (text) => {
              heard.current = text;
              onWords(text);
            },
            onFinal: (text) => {
              heard.current = text;
              onWords(text);
            },
            // Died mid-sentence: keep the words so far.
            onError: () => {
              stream.current = null;
              speechMic.release(session);
              if (live.current) done.current(heard.current, []);
            },
          })
        : null;
      if (attached?.kind !== 'ok') {
        await mic.discard();
        return !live.current;
      }
      if (!live.current) {
        attached.live.cancel();
        return true;
      }
      stream.current = attached.live;
      // A stream that never finishes (the finger stuck) ends at the relay's cap.
      cap.current = setTimeout(() => void finishStreamRef.current(), STREAM_MAX_SESSION_MS);
      if (finishRef.current) void finishStream();
      return true;
    } catch {
      return false;
    }
  };

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
      if (await startStream()) return;
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
