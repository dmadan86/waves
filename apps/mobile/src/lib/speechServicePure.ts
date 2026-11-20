/**
 * Which Android speech service the phone recogniser should use — pure, so the
 * choice is tested without a device.
 *
 * The Google app's recogniser is the one that works well; some phones default
 * to a service that returns nothing (`com.google.android.as`, Pixel's on-device
 * one, is never picked by name). iOS has no such choice.
 */

export const GOOGLE_APP_SERVICE = 'com.google.android.googlequicksearchbox';
export const GOOGLE_TTS_SERVICE = 'com.google.android.tts';
const NEVER_PICK = 'com.google.android.as';

/** The Google app if listed, else the phone's default, else the Google TTS service. */
export function pickRecognitionService(
  installed: readonly string[],
  defaultService: string | null | undefined,
): string {
  if (installed.includes(GOOGLE_APP_SERVICE)) return GOOGLE_APP_SERVICE;
  if (defaultService && defaultService !== NEVER_PICK) return defaultService;
  return GOOGLE_TTS_SERVICE;
}

const SERVICE_START_ERRORS: readonly string[] = ['client', 'busy', 'service-not-allowed'];

/**
 * An error that says the chosen service would not take the session (bind
 * failure, busy, refused) — worth one retry on the phone's default service.
 */
export function isServiceStartError(code: string): boolean {
  return SERVICE_START_ERRORS.includes(code);
}

/** Retry once, and only when a named service was in use. */
export function shouldRetryWithDefault(code: string, usedPackage: string | undefined, retried: boolean): boolean {
  return !retried && !!usedPackage && isServiceStartError(code);
}

/** A short lowercase word for telemetry (package names have dots, which events refuse). */
export function serviceWord(pkg: string | undefined): string {
  if (!pkg) return 'default';
  if (pkg === GOOGLE_APP_SERVICE) return 'google_app';
  if (pkg === GOOGLE_TTS_SERVICE) return 'google_tts';
  return 'other';
}
