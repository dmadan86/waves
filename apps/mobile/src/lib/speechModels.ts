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
  /** Whether this phone can recognise speech without a connection. */
  supportsOnDevice: () => boolean;
  /**
   * Whether {@link listLocales}'s `installedLocales` is a fact or an echo.
   *
   * Android reports the models actually on the device, separate from the ones it
   * merely supports. iOS assigns one to the other — its module literally returns
   * the supported list under both names — so on iPhone the answer means nothing
   * and must not be drawn as if it did.
   */
  reportsInstalled: () => boolean;
  /**
   * Whether a model can be fetched from inside the app.
   *
   * Android 13 and up. `androidTriggerOfflineModelDownload` is not implemented
   * in the iOS module at all — calling it there throws — and on Android below
   * API 33 the native side rejects it with `not_supported` before doing
   * anything. Both are checked here rather than left to fail at the tap, so no
   * button is ever offered that cannot work. iOS installs its dictation
   * languages through the system's own settings and offers no API to ask for
   * one, so the screen falls back to telling somebody where to tap.
   */
  canDownload: () => boolean;
  /** Ask the phone for its locale lists. Rejects on a service that is busy. */
  listLocales: () => Promise<SpeechLocales>;
  /** Ask the phone to fetch the model for `tag`. See {@link OfflineModelDownload}. */
  download: (tag: string) => Promise<OfflineModelDownload>;
}

/** The shape this file uses from the native module — no more than it needs. */
interface SpeechModule {
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
    supportsOnDevice: () => {
      try {
        return module.supportsOnDeviceRecognition();
      } catch {
        return false;
      }
    },
    reportsInstalled: () => Platform.OS === 'android',
    // API 33 is where the native side stops rejecting outright. `Platform.Version`
    // is the API level on Android (a string on iOS, which the platform check has
    // already excluded).
    canDownload: () => Platform.OS === 'android' && Number(Platform.Version) >= 33,
    listLocales: async () => {
      // The service package is named so this asks the *same* recogniser the mic
      // asks, and so cannot answer differently from it.
      //
      // It is worth being plain that this is a trade, not a free win. Naming a
      // package makes the native side bind to that service instead of the
      // on-device recogniser, and the library's own note is that installedLocales
      // "will likely be an empty array if the service package is not
      // com.google.android.as" — which the default service usually is not. So on
      // many phones this under-reports: models that are present read as absent.
      //
      // That is the direction to fail in. An under-report offers a download for
      // something already there, which costs a tap and resolves immediately. The
      // other direction — querying the on-device recogniser bare, getting a
      // fuller list, and ticking a model the mic (which asks by package) will not
      // find — is the silence bug this whole screen exists to cure. Until the mic
      // and this share one probe, they stay wrong the same way.
      let androidRecognitionServicePackage: string | undefined;
      try {
        const packageName = module.getDefaultRecognitionService?.().packageName;
        if (packageName) androidRecognitionServicePackage = packageName;
      } catch {
        // No service to name — query without one rather than fail the read.
      }
      // iOS has no service concept and answers with an empty package name, so it
      // falls through to the bare query on its own.
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
