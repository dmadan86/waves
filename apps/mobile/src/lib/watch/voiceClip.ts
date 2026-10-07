/**
 * The impure half of watch voice clips: reading the file, calling the agent and
 * running on-device recognition on it. Pure decisions live in `voiceClipPure`.
 *
 * `expo-speech-recognition` throws at import in a binary built before the
 * native module existed, and expo-router loads every file at launch, so it is
 * reached through a guarded `require` exactly as `DictateButton` does.
 */

import * as FileSystem from 'expo-file-system';

import { VOICE_AGENT_SCHEMA_VERSION } from '@waves/core';

import { callVoiceAgent } from '@/lib/voiceAgent';
import { speechMic } from '@/lib/speechMic';

import type { ClipDeps } from './voiceClipPure';

/** The watch records AAC in an MP4 container (.m4a). */
const CLIP_MIME = 'audio/mp4';
/** A clip is at most 30 s; recognition of it should not take longer than this. */
const TRANSCRIBE_TIMEOUT_MS = 45_000;

export function readClipBase64(uri: string): Promise<string> {
  return new FileSystem.File(uri).base64();
}

export function deleteClip(uri: string): void {
  try {
    const file = new FileSystem.File(uri);
    if (file.exists) file.delete();
  } catch {
    // A cache file; the OS reclaims it if this fails.
  }
}

export function agentCall(input: { locale: string; today: string }): ClipDeps['callAgent'] {
  return async ({ audioBase64, durationMs }) => {
    const result = await callVoiceAgent({
      schemaVersion: VOICE_AGENT_SCHEMA_VERSION,
      audioBase64,
      mimeType: CLIP_MIME,
      durationMs,
      locale: input.locale.split(/[-_]/)[0]?.toLowerCase() || 'en',
      today: input.today,
    });
    return result.kind === 'ok' ? { kind: 'ok', response: result.response } : { kind: 'error' };
  };
}

interface SpeechModule {
  requestPermissionsAsync(): Promise<{ granted: boolean }>;
  start(options: Record<string, unknown>): void;
  abort(): void;
  stop(): void;
  addListener(event: string, handler: (event: never) => void): { remove(): void };
}

function loadSpeech(): SpeechModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('expo-speech-recognition') as {
      ExpoSpeechRecognitionModule: SpeechModule;
    };
    return loaded.ExpoSpeechRecognitionModule;
  } catch {
    return null;
  }
}

/**
 * Recognise a recorded file on this phone. Resolves the final transcript, ''
 * when nothing was heard, or null when recognition could not run (no module,
 * permission refused, the mic busy with a live capture, an error).
 */
export async function transcribeFile(uri: string, lang: string): Promise<string | null> {
  const speech = loadSpeech();
  if (!speech) return null;
  const token = Symbol('watch-clip');
  speechMic.attach({ stop: () => speech.stop(), abort: () => speech.abort() });
  if (!(await speechMic.acquire(token))) return null;
  try {
    const permission = await speech.requestPermissionsAsync();
    if (!permission.granted) {
      speechMic.release(token);
      return null;
    }
    return await new Promise<string | null>((resolve) => {
      let latest = '';
      let failed = false;
      const subs: { remove(): void }[] = [];
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (value: string | null): void => {
        if (timer) clearTimeout(timer);
        for (const sub of subs) sub.remove();
        speechMic.release(token);
        resolve(value);
      };
      subs.push(
        speech.addListener('result', ((event: { results?: { transcript?: string }[] }) => {
          const text = event.results?.[0]?.transcript;
          if (typeof text === 'string') latest = text;
        }) as (event: never) => void),
        speech.addListener('error', (() => {
          failed = true;
          speechMic.errored(token);
        }) as (event: never) => void),
        speech.addListener('end', (() => {
          if (!speechMic.ended(token)) return;
          finish(failed && latest === '' ? null : latest);
        }) as (event: never) => void),
      );
      timer = setTimeout(() => {
        try {
          speech.abort();
        } catch {
          // already finished
        }
        finish(latest === '' ? null : latest);
      }, TRANSCRIBE_TIMEOUT_MS);
      try {
        speech.start({
          lang,
          interimResults: false,
          maxAlternatives: 1,
          continuous: false,
          addsPunctuation: false,
          audioSource: { uri },
        });
        speechMic.opened(token);
      } catch {
        finish(null);
      }
    });
  } catch {
    speechMic.release(token);
    return null;
  }
}
