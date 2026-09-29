/**
 * No orientation lock in the manifest, for Play's large-screen check.
 *
 * From Android 16, the system ignores `android:screenOrientation` on large
 * screens (tablets, foldables), and Play flags every activity that still
 * declares it. Three did: `MainActivity`, from `"orientation"` in app.json, and
 * ML Kit's barcode and document scanner hand-off activities, from the library's
 * own manifest.
 *
 * `MainActivity`'s is gone because app.json now says `"default"`. Phones are
 * still held upright, but at runtime (`src/lib/phoneOrientation.ts`), where a
 * tablet is allowed to turn. The two ML Kit activities are only transparent
 * trampolines into Google Play services' own scanner UI, so their lock is
 * dropped with a `tools:remove` merge rule rather than patched in the library.
 */

const { withAndroidManifest } = require('expo/config-plugins');

const LIBRARY_ACTIVITIES = [
  'com.google.mlkit.vision.codescanner.internal.GmsBarcodeScanningDelegateActivity',
  'com.google.mlkit.vision.documentscanner.internal.GmsDocumentScanningDelegateActivity',
];

module.exports = function withLargeScreenOrientation(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] ?? 'http://schemas.android.com/tools';
    const application = manifest.application?.[0];
    if (!application) return mod;
    application.activity = application.activity ?? [];

    for (const activity of application.activity) {
      if (activity.$['android:name'] === '.MainActivity') {
        delete activity.$['android:screenOrientation'];
      }
    }

    for (const name of LIBRARY_ACTIVITIES) {
      const existing = application.activity.find((activity) => activity.$['android:name'] === name);
      const entry = existing ?? { $: { 'android:name': name } };
      entry.$['tools:remove'] = 'android:screenOrientation';
      if (!existing) application.activity.push(entry);
    }
    return mod;
  });
};
