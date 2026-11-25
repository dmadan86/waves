// The OTA runtime ignores the app's version name and versionCode: a store
// release that changes only those keeps receiving the same OTA updates.
// See scripts/ota-publish.mjs (native-fingerprint.json guard) and docs/ota.md.
/** @type {import('expo/fingerprint').Config} */
const { SourceSkips } = require('expo/fingerprint');

module.exports = {
  sourceSkips:
    SourceSkips.ExpoConfigVersions |
    SourceSkips.ExpoConfigRuntimeVersionIfString |
    // `extra` is read by JS only, and carries the build's git commit, which would
    // otherwise change the fingerprint on every commit and refuse every OTA.
    SourceSkips.ExpoConfigExtraSection |
    SourceSkips.PackageJsonAndroidAndIosScriptsIfNotContainRun,
};
