/**
 * Start the default Firebase app (and ML Kit) from `MainApplication.onCreate`
 * when the platform did not.
 *
 * Firebase normally starts itself through `FirebaseInitProvider`, a content
 * provider Android runs before `Application.onCreate`. On 2026-10-03 a vivo
 * phone stopped running that provider for Waves — every launch, every build,
 * including builds that had worked the day before — and the first native
 * module to touch Firebase (`@react-native-firebase/app-check`) threw
 * "Default FirebaseApp is not initialized in this process", which expo-updates'
 * error recovery turned into a crash on every launch. Why the provider was
 * skipped was never found; the device registered it, enabled it, and the
 * merged manifest and resources were correct.
 *
 * So the app checks for itself. If no Firebase app exists by the time
 * `onCreate` runs, it initializes the default one from the same
 * `google-services` resources the provider would have read. When the provider
 * did run, `getApps` is non-empty and this does nothing.
 *
 * Reflection rather than an import: `com.google.firebase` is an implementation
 * dependency of the React Native Firebase modules, not on the app module's
 * compile classpath. The block is wrapped so a missing class can never take the
 * app down — at worst it does nothing, which is today's behaviour.
 */

const { withMainApplication } = require('expo/config-plugins');

const MARKER = 'waves-firebase-init-fallback';

const KOTLIN_BLOCK = `
    // @generated begin ${MARKER} - see plugins/withFirebaseInitFallback.js
    try {
      val firebaseApp = Class.forName("com.google.firebase.FirebaseApp")
      val apps = firebaseApp.getMethod("getApps", android.content.Context::class.java).invoke(null, this) as List<*>
      if (apps.isEmpty()) {
        firebaseApp.getMethod("initializeApp", android.content.Context::class.java).invoke(null, this)
      }
    } catch (e: Throwable) {
      android.util.Log.w("WavesFirebase", "Firebase init fallback skipped", e)
    }
    // ML Kit starts the same way (MlKitInitProvider), so a phone that skips
    // Firebase's provider skips this one too, and every barcode scan — the
    // camera's and a QR read from a photo — fails with "MlKitContext has not
    // been initialized". initializeIfNeeded is a no-op when it did run.
    try {
      Class.forName("com.google.mlkit.common.sdkinternal.MlKitContext")
        .getMethod("initializeIfNeeded", android.content.Context::class.java)
        .invoke(null, this)
    } catch (e: Throwable) {
      android.util.Log.w("WavesFirebase", "ML Kit init fallback skipped", e)
    }
    // @generated end ${MARKER}
`;

/**
 * Insert the block right after `super.onCreate()` in a Kotlin MainApplication,
 * once. Throws when there is no `super.onCreate()` to anchor on, so a template
 * change fails the prebuild loudly instead of silently shipping without it.
 */
function withFallback(contents) {
  if (contents.includes(MARKER)) return contents;
  const anchor = /(override fun onCreate\(\)\s*\{\s*\n\s*super\.onCreate\(\)\s*\n)/;
  if (!anchor.test(contents)) {
    throw new Error('withFirebaseInitFallback: could not find super.onCreate() in MainApplication');
  }
  return contents.replace(anchor, `$1${KOTLIN_BLOCK}`);
}

function withFirebaseInitFallback(config) {
  return withMainApplication(config, (mod) => {
    if (mod.modResults.language !== 'kt') {
      throw new Error('withFirebaseInitFallback: expected a Kotlin MainApplication');
    }
    mod.modResults.contents = withFallback(mod.modResults.contents);
    return mod;
  });
}

module.exports = withFirebaseInitFallback;
module.exports._internals = { MARKER, withFallback };
