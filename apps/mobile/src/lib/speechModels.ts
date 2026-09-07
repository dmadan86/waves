/**
 * A non-throwing gate to the speech recogniser's *model* surface.
 *
 * `expo-speech-recognition` calls `requireNativeModule` at the top of its file,
 * so importing it in a binary built before the native module existed throws at
 * load — and expo-router loads every route file to build its route tree, so a
 * plain import in the offline-voice route would kill the app at launch rather
 * than break one screen. The module is therefore reached through a guarded
 * `require`, exactly as `VoiceMicPanel` reaches the microphone and `nativeMaps`
 * reaches Google Maps. When it is absent this is `null` and the screen says so.
 *
 * Only the model-management calls live here. The microphone itself stays in
 * `VoiceCapture`, which owns the one recogniser session (see `speechMic.ts`);
 * nothing on this path starts or stops a capture.
 */

import { Platform } from 'react-native';

/**
 * What the phone says when asked to fetch a model.
 *
 * These are the library's own words, and they are worth keeping apart because
 * they mean three different things to the person waiting: the model is here,
 * the system has taken over with a dialog of its own, or it has been queued for
 * later (typically until the phone is on Wi-Fi).
 */
export type OfflineModelDownload = 'download_success' | 'opened_dialog' | 'download_scheduled';

/** The locales the recogniser knows about, and the ones it already holds. */
export interface SpeechLocales {
  readonly locales: string[];
  readonly installedLocales: string[];
}

export interface SpeechModelsApi {
  /** Whether a recogniser is usable at all on this phone right now. */
  available: () => boolean;
  /** Whether this phone can recognise speech without a connection. */
  supportsOnDevice: () => boolean;
  /**
   * Whether a model can be fetched from inside the app.
   *
   * Android only, and only from Android 13: `androidTriggerOfflineModelDownload`
   * is not implemented on iOS at all (calling it there throws), and it rejects
   * with `not_supported` below API 33. iOS installs its dictation languages
   * through the system's own settings and offers no API to ask for one, so the
   * screen falls back to telling somebody where to tap.
   */
  canDownload: () => boolean;
  /** Ask the phone for its locale lists. Rejects on a service that is busy. */
  listLocales: () => Promise<SpeechLocales>;
  /** Ask the phone to fetch the model for `tag`. See {@link OfflineModelDownload}. */
  download: (tag: string) => Promise<OfflineModelDownload>;
}

/** The shape this file uses from the native module — no more than it needs. */
interface SpeechModule {
  isRecognitionAvailable: () => boolean;
  supportsOnDeviceRecognition: () => boolean;
  getDefaultRecognitionService?: () => { packageName: string };
  getSupportedLocales: (options: {
    androidRecognitionServicePackage?: string;
  }) => Promise<SpeechLocales>;
  androidTriggerOfflineModelDownload: (options: {
    locale: string;
  }) => Promise<{ status: OfflineModelDownload; message: string }>;
}

function load(): SpeechModelsApi | null {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  let module: SpeechModule;
  try {
    // Deliberately require, not import: an import is hoisted to module load,
    // which is the throw this whole file exists to contain.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('expo-speech-recognition') as {
      ExpoSpeechRecognitionModule: SpeechModule;
    };
    module = loaded.ExpoSpeechRecognitionModule;
    if (typeof module?.getSupportedLocales !== 'function') return null;
  } catch {
    return null;
  }

  return {
    available: () => {
      try {
        return module.isRecognitionAvailable();
      } catch {
        return false;
      }
    },
    supportsOnDevice: () => {
      try {
        return module.supportsOnDeviceRecognition();
      } catch {
        return false;
      }
    },
    canDownload: () => Platform.OS === 'android',
    listLocales: async () => {
      // Asking Google's own recogniser by name is what makes `installedLocales`
      // meaningful: the library returns an empty installed list for any other
      // service package. iOS has no service concept, so it is queried bare.
      let androidRecognitionServicePackage: string | undefined;
      try {
        const packageName = module.getDefaultRecognitionService?.().packageName;
        if (packageName) androidRecognitionServicePackage = packageName;
      } catch {
        // No service to name — query without one rather than fail the read.
      }
      const answer = await module.getSupportedLocales(
        androidRecognitionServicePackage ? { androidRecognitionServicePackage } : {},
      );
      return {
        locales: answer.locales ?? [],
        installedLocales: answer.installedLocales ?? [],
      };
    },
    download: async (tag: string) => {
      const { status } = await module.androidTriggerOfflineModelDownload({ locale: tag });
      return status;
    },
  };
}

/**
 * The phone's speech models, or null on a build that cannot reach them.
 *
 * Resolved once at module load — the native module either imports or it does
 * not, and that answer cannot change while the app is running.
 */
export const speechModels: SpeechModelsApi | null = load();
