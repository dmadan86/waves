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

const DEBUG_BUILD_TYPE = `        debug {
            signingConfig signingConfigs.debug`;

const DEBUG_BUILD_TYPE_PATCHED = `        debug {
            // ${MARKER} — see apps/mobile/plugins/withSideBySideDebug.js
            applicationIdSuffix '${SUFFIX}'
            versionNameSuffix '-debug'
            signingConfig signingConfigs.debug`;

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

    if (!contents.includes(DEBUG_BUILD_TYPE)) {
      throw new Error('withSideBySideDebug: could not find the debug buildType in build.gradle');
    }
    gradleConfig.modResults.contents = contents.replace(
      DEBUG_BUILD_TYPE,
      DEBUG_BUILD_TYPE_PATCHED,
    );
    return gradleConfig;
  });

  // Both files live in the debug source set rather than in `main`, where they
  // would change the release build too. A resource or a config defined in a
  // build type's source set replaces the one in `main` for that variant only.
  return withDangerousMod(withGradle, [
    'android',
    (modConfig) => {
      const debugSrc = join(modConfig.modRequest.platformProjectRoot, 'app', 'src', 'debug');

      const values = join(debugSrc, 'res', 'values');
      mkdirSync(values, { recursive: true });
      writeFileSync(
        join(values, 'strings.xml'),
        `<resources>\n  <string name="app_name">${DEBUG_LABEL}</string>\n</resources>\n`,
        'utf8',
      );

      const source = sourceGoogleServices(modConfig.modRequest.projectRoot);
      const appId = modConfig.android?.package;
      if (source && appId) {
        // Rewritten by walking the parsed object rather than replacing text: the
        // package name appears in `client_info` for each client, and a blind
        // string replace would also hit an `oauth_client` entry that names the
        // same package with a *different* signing certificate, which is a
        // credential rather than an id.
        const services = JSON.parse(readFileSync(source, 'utf8'));
        for (const client of services.client ?? []) {
          const info = client.client_info?.android_client_info;
          if (info?.package_name === appId) info.package_name = `${appId}${SUFFIX}`;
        }
        mkdirSync(debugSrc, { recursive: true });
        writeFileSync(
          join(debugSrc, 'google-services.json'),
          `${JSON.stringify(services, null, 2)}\n`,
          'utf8',
        );
      }

      return modConfig;
    },
  ]);
};
