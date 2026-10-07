/**
 * The voice test recorder's device half: the mic, the files, the phone's own
 * recogniser and the share sheet. Nothing here touches the network — the only
 * way a recording leaves the phone is the tester pressing Share.
 *
 * Audio is captured the way `voiceStream` captures it (`@siteed/audio-studio`,
 * 16 kHz mono 16-bit PCM chunks) and written out as a WAV by us, so there is no
 * dependency on the library's file-output options. Native modules are required
 * lazily: a binary built without them reads as "unavailable", not a crash.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { appVersion } from '@/lib/device';
import {
  type ManifestDevice,
  type ManifestSpeaker,
  type OnDeviceResult,
  type RecorderManifest,
} from '@/lib/voiceRecorderPure';
import {
  buildZip,
  pcmDurationMs,
  pcmToWav,
  SILENCE_START,
  stepSilence,
  type ZipEntry,
} from '@/lib/voiceRecorderAudio';
import { base64ToBytes, pcmLevel } from '@/lib/voiceStreamPure';

const PROFILE_KEY = 'waves.voiceRecorder.profile.v1';
const ROOT_NAME = 'voice-recorder';
const MANIFEST = 'manifest.json';
const ALTERNATIVES_MAX = 5;
const TRANSCRIBE_TIMEOUT_MS = 20_000;

// ───────────────────────────────────────────────────────────── profile ──

export interface RecorderProfile {
  consented: boolean;
  label: string;
  languageBackground: string | null;
  accent: string | null;
}

export const EMPTY_PROFILE: RecorderProfile = {
  consented: false,
  label: '',
  languageBackground: null,
  accent: null,
};

export async function loadProfile(): Promise<RecorderProfile> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_KEY);
    if (!raw) return EMPTY_PROFILE;
    return { ...EMPTY_PROFILE, ...(JSON.parse(raw) as Partial<RecorderProfile>) };
  } catch {
    return EMPTY_PROFILE;
  }
}

export async function saveProfile(profile: RecorderProfile): Promise<void> {
  try {
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Asked again next time; nothing is lost but a form.
  }
}

export function deviceInfo(locale: string): ManifestDevice {
  return {
    model: Device.modelName ?? Device.deviceName ?? 'unknown',
    os: Platform.OS,
    osVersion: Device.osVersion ?? String(Platform.Version),
    appVersion: appVersion() ?? 'unknown',
    locale,
  };
}

export function speakerOf(profile: RecorderProfile): ManifestSpeaker {
  return {
    label: profile.label,
    languageBackground: profile.languageBackground,
    accent: profile.accent,
  };
}

// ────────────────────────────────────────────────────────────── native ──

interface AudioModule {
  startRecording: (config: Record<string, unknown>) => Promise<unknown>;
  stopRecording: () => Promise<unknown>;
  addListener: (
    name: string,
    listener: (event: { encoded?: string; deltaSize?: number }) => void,
  ) => { remove: () => void };
}

function loadAudio(): AudioModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const studio = require('@siteed/audio-studio') as { AudioStudioModule: AudioModule };
    return studio.AudioStudioModule ?? null;
  } catch {
    return null;
  }
}

export function recorderAvailable(): boolean {
  return loadAudio() !== null;
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

/**
 * Whether the phone can recognise a saved file on-device. The library supports
 * `audioSource.uri` on Android 13+ and iOS; and it must be an on-device model,
 * because a network recogniser would send the audio off the phone.
 */
export function onDeviceFileSupported(): boolean {
  if (Platform.OS === 'android' && Number(Platform.Version) < 33) return false;
  const speech = loadSpeech();
  if (!speech) return false;
  try {
    return speech.supportsOnDeviceRecognition();
  } catch {
    return false;
  }
}

export async function requestMic(): Promise<boolean> {
  const speech = loadSpeech();
  if (!speech) return false;
  try {
    const result = await speech.requestPermissionsAsync();
    return result.granted;
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────────────────── recording ──

export interface Take {
  /** Stop and return the PCM captured so far. */
  stop: () => Promise<Uint8Array>;
}

/**
 * Open the mic. `onLevel` gets 0…1 per chunk; `onAutoStop` fires once when the
 * silence rule ends the take (the caller then calls `stop()` for the audio).
 */
export async function startTake(
  onLevel: (level: number) => void,
  onAutoStop: () => void,
): Promise<Take | null> {
  const audio = loadAudio();
  if (!audio) return null;
  const chunks: Uint8Array[] = [];
  let silence = SILENCE_START;
  let autoStopped = false;
  const subscription = audio.addListener('AudioData', (event) => {
    if (!event.encoded || event.deltaSize === 0) return;
    const bytes = base64ToBytes(event.encoded);
    if (bytes.length === 0) return;
    chunks.push(bytes);
    const level = pcmLevel(bytes);
    onLevel(level);
    const step = stepSilence(silence, level, pcmDurationMs(bytes.length));
    silence = step.state;
    if (step.stop && !autoStopped) {
      autoStopped = true;
      onAutoStop();
    }
  });
  try {
    await audio.startRecording({
      sampleRate: 16000,
      channels: 1,
      encoding: 'pcm_16bit',
      interval: 100,
      output: { primary: { enabled: false } },
    });
  } catch {
    subscription.remove();
    return null;
  }
  let stopped: Promise<Uint8Array> | null = null;
  return {
    stop: () => {
      stopped ??= (async () => {
        subscription.remove();
        try {
          await audio.stopRecording();
        } catch {
          // Already stopped.
        }
        const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
        let at = 0;
        for (const chunk of chunks) {
          out.set(chunk, at);
          at += chunk.length;
        }
        return out;
      })();
      return stopped;
    },
  };
}

// ────────────────────────────────────────────────── on-device recogniser ──

/** Run the phone's own recogniser over a saved WAV; never throws. */
export async function transcribeOnDevice(uri: string, lang: string): Promise<OnDeviceResult> {
  if (!onDeviceFileSupported()) return { alternatives: [], note: 'unsupported' };
  const speech = loadSpeech();
  if (!speech) return { alternatives: [], note: 'unsupported' };
  return new Promise<OnDeviceResult>((resolve) => {
    let best: string[] = [];
    let settled = false;
    const subs: { remove: () => void }[] = [];
    const finish = (note?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const sub of subs) sub.remove();
      resolve({ alternatives: best, ...(best.length === 0 ? { note: note ?? 'no-result' } : {}) });
    };
    const timer = setTimeout(() => {
      try {
        speech.abort();
      } catch {
        // Nothing running.
      }
      finish('timeout');
    }, TRANSCRIBE_TIMEOUT_MS);
    subs.push(
      speech.addListener('result', (event) => {
        const texts = event.results.map((r) => r.transcript).filter((t) => t.length > 0);
        if (texts.length > 0) best = texts.slice(0, ALTERNATIVES_MAX);
        if (event.isFinal) finish();
      }),
      speech.addListener('error', (event) => finish(event.error)),
      speech.addListener('end', () => finish()),
    );
    try {
      speech.start({
        lang,
        interimResults: false,
        maxAlternatives: ALTERNATIVES_MAX,
        continuous: false,
        requiresOnDeviceRecognition: true,
        audioSource: {
          uri,
          audioChannels: 1,
          audioEncoding: 2, // AudioEncodingAndroid.ENCODING_PCM_16BIT
          sampleRate: 16000,
        },
      });
    } catch {
      finish('start-failed');
    }
  });
}

// ──────────────────────────────────────────────────────────────── files ──

function root(): FileSystem.Directory {
  return new FileSystem.Directory(FileSystem.Paths.document, ROOT_NAME);
}

function sessionDir(sessionId: string): FileSystem.Directory {
  return new FileSystem.Directory(root(), sessionId);
}

export function createSession(sessionId: string): void {
  const parent = root();
  if (!parent.exists) parent.create({ intermediates: true });
  const dir = sessionDir(sessionId);
  if (!dir.exists) dir.create({ intermediates: true });
}

export function writeManifest(manifest: RecorderManifest): void {
  const file = new FileSystem.File(sessionDir(manifest.sessionId), MANIFEST);
  if (!file.exists) file.create();
  file.write(JSON.stringify(manifest, null, 2));
}

/** Save one take as `<id>.wav`; returns the file name, uri and length. */
export function writeTake(
  sessionId: string,
  promptId: string,
  pcm: Uint8Array,
): { file: string; uri: string; durationMs: number } {
  const name = `${promptId}.wav`;
  const file = new FileSystem.File(sessionDir(sessionId), name);
  if (!file.exists) file.create();
  file.write(pcmToWav(pcm));
  return { file: name, uri: file.uri, durationMs: pcmDurationMs(pcm.length) };
}

export function deleteTake(sessionId: string, name: string): void {
  try {
    const file = new FileSystem.File(sessionDir(sessionId), name);
    if (file.exists) file.delete();
  } catch {
    // Gone already.
  }
}

/** The newest session folder's manifest, if one exists and parses. */
export function loadLatestSession(): RecorderManifest | null {
  try {
    const parent = root();
    if (!parent.exists) return null;
    const dirs = parent
      .list()
      .filter((entry): entry is FileSystem.Directory => entry instanceof FileSystem.Directory)
      .sort((a, b) => (a.name < b.name ? 1 : -1));
    for (const dir of dirs) {
      const file = new FileSystem.File(dir, MANIFEST);
      if (!file.exists) continue;
      return JSON.parse(file.textSync()) as RecorderManifest;
    }
  } catch {
    // Unreadable: start a fresh session.
  }
  return null;
}

export function deleteAllRecordings(): void {
  const parent = root();
  if (parent.exists) parent.delete();
}

export function hasRecordings(): boolean {
  try {
    const parent = root();
    return parent.exists && parent.list().length > 0;
  } catch {
    return false;
  }
}

/** Zip the session folder and open the share sheet. False if sharing is unavailable. */
export async function shareSession(sessionId: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  const dir = sessionDir(sessionId);
  const entries: ZipEntry[] = [];
  for (const item of dir.list()) {
    if (item instanceof FileSystem.File) {
      entries.push({ name: `${sessionId}/${item.name}`, bytes: await item.bytes() });
    }
  }
  const zip = new FileSystem.File(FileSystem.Paths.cache, `${sessionId}.zip`);
  if (zip.exists) zip.delete();
  zip.create();
  zip.write(buildZip(entries, new Date()));
  await Sharing.shareAsync(zip.uri, {
    mimeType: 'application/zip',
    dialogTitle: 'Voice recordings',
    UTI: 'public.zip-archive',
  });
  try {
    zip.delete();
  } catch {
    // The cache is cleared by the OS anyway.
  }
  return true;
}
