/**
 * Let the debug build sit on the phone next to the release one.
 *
 * Android identifies an installed app by its application id, so two builds that
 * share one can never both be on a device — installing the second replaces the
 * first, and the release build a change is being checked against disappears the
 * moment the debug build lands. That is exactly backwards for testing: the
 * comparison is the point.
 *
 * So the debug variant takes `.debug` on the end of its application id, its own
 * launcher label, and `-debug` on its version name (visible in Settings → Apps,
 * which is otherwise the only way to tell two identically-named apps apart).
 *
 * **The suffixed id has no client in `google-services.json`**, and the Google
 * Services gradle plugin fails a build outright rather than skipping when it
 * cannot find one. This used to be handled by disabling `processDebugGoogleServices`
 * — the debug build then carried no Firebase config at all, which was survivable
 * while push was the only thing that wanted it (`lib/push.ts` says it cannot
 * register, and nothing throws).
 *
 * It stopped being survivable when `@react-native-firebase/app-check` arrived.
 * Its TurboModule calls `FirebaseAppCheck.getInstance()` from its constructor,
 * which happens while React Native is building the module list, long before any
 * of this app's JavaScript can decide not to use it. With no config that throws
 * `Default FirebaseApp is not initialized in this process`, and the debug build
 * dies on the splash screen — every debug build, whatever is being tested.
 *
 * So the config is written instead of skipped: the debug source set gets its own
 * `google-services.json`, the real one with the client's `package_name` rewritten
 * to the suffixed id. The Google Services plugin prefers a variant's copy over
 * the root one, finds its client, and Firebase initialises. Every value in it is
 * the real project's, so nothing is invented — but Firebase has never heard of
 * the suffixed application id, so **push and App Check still do not work in a
 * debug build**: registering for push fails the way it always has, and an App
 * Check attestation is refused by the server. What changes is that the app now
 * starts.
 *
 * The same goes for the `preview` build type: a release build (minified, bundled
 * JS, release signing) under `<package>.preview`, labelled "Waves test", so a test
 * build can sit next to the one installed from the Play Store instead of replacing
 * it. Build it with `./gradlew assemblePreview`. Purchases never work in it: Play
 * only bills the application id it publishes.
 *
 * To give the debug build push as well: add an Android app for `<package>.debug`
 * in the Firebase console and download the regenerated `google-services.json`
 * (it carries both clients) — the file written here is then redundant, and this
 * whole mod can go.
 */

const { withAppBuildGradle, withDangerousMod } = require('expo/config-plugins');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const MARKER = 'waves:side-by-side-debug';

/** What the launcher calls the debug build, so the two icons are tellable apart. */
const DEBUG_LABEL = 'Waves dev';

/** The suffix, in one place: the gradle patch and the config rewrite must agree. */
const SUFFIX = '.debug';

const PREVIEW_LABEL = 'Waves test';
const PREVIEW_SUFFIX = '.preview';

/** Appended after the main `android {}` block so `initWith release` copies a finished release. */
const PREVIEW_BUILD_TYPE = `
// ${MARKER} — see apps/mobile/plugins/withSideBySideDebug.js
android {
    buildTypes {
        preview {
            initWith release
            applicationIdSuffix '.preview'
            versionNameSuffix '-preview'
            matchingFallbacks = ['release']
        }
    }
}
`;

const DEBUG_BUILD_TYPE = `        debug {
            signingConfig signingConfigs.debug`;

const DEBUG_BUILD_TYPE_PATCHED = `        debug {
            // ${MARKER} — see apps/mobile/plugins/withSideBySideDebug.js
            applicationIdSuffix '${SUFFIX}'
            versionNameSuffix '-debug'
            signingConfig signingConfigs.debug`;

/** Newer Expo templates write `signingConfig = signingConfigs.debug`; accept both. */
const DEBUG_BUILD_TYPE_ASSIGN = DEBUG_BUILD_TYPE.replace(
  'signingConfig signingConfigs',
  'signingConfig = signingConfigs',
);

/**
 * The same resolution `app.config.ts` uses for `android.googleServicesFile`: the
 * EAS file secret first, the developer's local copy second, nothing if this
 * machine has neither (in which case the Google Services plugin is not applied
 * and there is nothing to rewrite).
 */
function sourceGoogleServices(projectRoot) {
  const fromEas = process.env.GOOGLE_SERVICES_JSON;
  if (fromEas && existsSync(fromEas)) return fromEas;

  const local = resolve(projectRoot, 'google-services.json');
  return existsSync(local) ? local : undefined;
}

module.exports = function withSideBySideDebug(config) {
  const withGradle = withAppBuildGradle(config, (gradleConfig) => {
    const contents = gradleConfig.modResults.contents;
    if (contents.includes(MARKER)) return gradleConfig;

    const anchor = contents.includes(DEBUG_BUILD_TYPE_ASSIGN)
      ? DEBUG_BUILD_TYPE_ASSIGN
      : DEBUG_BUILD_TYPE;
    if (!contents.includes(anchor)) {
      throw new Error('withSideBySideDebug: could not find the debug buildType in build.gradle');
    }
    gradleConfig.modResults.contents =
      contents.replace(anchor, DEBUG_BUILD_TYPE_PATCHED) + PREVIEW_BUILD_TYPE;
    return gradleConfig;
  });

  // Both files live in the debug / preview source sets rather than in `main`,
  // where they would change the release build too. A resource or a config defined in a
  // build type's source set replaces the one in `main` for that variant only.
  return withDangerousMod(withGradle, [
    'android',
    (modConfig) => {
      const source = sourceGoogleServices(modConfig.modRequest.projectRoot);
      const appId = modConfig.android?.package;
      for (const [variant, label, suffix] of [
        ['debug', DEBUG_LABEL, SUFFIX],
        ['preview', PREVIEW_LABEL, PREVIEW_SUFFIX],
      ]) {
        const src = join(modConfig.modRequest.platformProjectRoot, 'app', 'src', variant);

        const values = join(src, 'res', 'values');
        mkdirSync(values, { recursive: true });
        writeFileSync(
          join(values, 'strings.xml'),
          `<resources>\n  <string name="app_name">${label}</string>\n</resources>\n`,
          'utf8',
        );

        // The update request header is baked into the manifest from EAS_BUILD_PROFILE, which local
        // Gradle builds never set; the preview build type always asks for the preview channel.
        if (variant === 'preview') {
          writeFileSync(
            join(src, 'AndroidManifest.xml'),
            `<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">\n  <application>\n    <meta-data android:name="expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY" android:value="{&quot;expo-channel-name&quot;:&quot;preview&quot;}" tools:replace="android:value" />\n  </application>\n</manifest>\n`,
            'utf8',
          );
        }

        const services = source && appId ? JSON.parse(readFileSync(source, 'utf8')) : null;
        const registered = services?.client?.some(
          (c) => c.client_info?.android_client_info?.package_name === `${appId}${suffix}`,
        );
        // Firebase knows this variant's id (the preview app is registered): the root file already works.
        if (services && !registered) {
          // Rewritten by walking the parsed object rather than replacing text: the
          // package name appears in `client_info` for each client, and a blind
          // string replace would also hit an `oauth_client` entry that names the
          // same package with a *different* signing certificate, which is a
          // credential rather than an id.
          for (const client of services.client ?? []) {
            const info = client.client_info?.android_client_info;
            if (info?.package_name === appId) info.package_name = `${appId}${suffix}`;
          }
          writeFileSync(
            join(src, 'google-services.json'),
            `${JSON.stringify(services, null, 2)}\n`,
            'utf8',
          );
        }
      }

      return modConfig;
    },
  ]);
};
