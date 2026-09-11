/**
 * The release build is signed with a real key, and the plugin that makes it so
 * still fits the template it patches.
 *
 * `withReleaseSigning` edits Expo's generated `build.gradle` by quoting it. That
 * is fragile by construction, and the failure it guards against is the silent
 * one: an upgrade rewords the template, the anchors stop matching, and the
 * release build goes back to debug signing while looking exactly the same. So
 * every anchor is asserted at prebuild rather than skipped — and these tests are
 * what prove the assertions still fire.
 *
 * The fixture is the shape Expo generates, kept here rather than read off
 * `android/` (which is gitignored, so CI has none).
 */

import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const withReleaseSigning = require('../plugins/withReleaseSigning.js') as ((
  config: object,
) => object) & {
  patchBuildGradle: (contents: string) => string;
};
const { patchBuildGradle } = withReleaseSigning;

const TEMPLATE = `android {
    namespace 'app.waves.mobile'
    defaultConfig {
        applicationId 'app.waves.mobile'
        versionCode 1
        versionName "1.0.0"
    }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            minifyEnabled enableProguardInReleaseBuilds
        }
    }
}
`;

describe('the release signing patch', () => {
  const patched = patchBuildGradle(TEMPLATE);

  it('stops the release build from being signed with the debug key unconditionally', () => {
    expect(TEMPLATE).toContain('        release {\n            // Caution!');
    expect(patched).toContain(
      'signingConfig wavesHasUploadKey ? signingConfigs.release : signingConfigs.debug',
    );
  });

  it('reads the key from gradle properties, never from a path in the repo', () => {
    expect(patched).toContain("findProperty('WAVES_UPLOAD_STORE_FILE')");
    expect(patched).toContain("findProperty('WAVES_UPLOAD_STORE_PASSWORD')");
    expect(patched).toContain("findProperty('WAVES_UPLOAD_KEY_ALIAS')");
    expect(patched).toContain("findProperty('WAVES_UPLOAD_KEY_PASSWORD')");
    // Nothing literal in the block it adds: no keystore path, no password.
    // Scoped to that block on purpose — the debug config it leaves alone does
    // carry a literal password, and that one is public by design.
    const release = patched.slice(
      patched.indexOf('        release {\n            if (wavesHasUploadKey)'),
    );
    const uploadBlock = release.slice(0, release.indexOf('\n    }'));
    expect(uploadBlock).not.toMatch(/storePassword\s+'/);
    expect(uploadBlock).not.toMatch(/\.jks/);
  });

  it('leaves the debug signing config exactly as it was', () => {
    // The debug key still has to work: it signs the sideload APKs and every
    // `expo run:android`.
    expect(patched).toContain(`        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }`);
  });

  it('fails a bundleRelease with no key rather than uploading something Play refuses', () => {
    expect(patched).toContain("graph.allTasks.any { it.name.startsWith('bundleRelease') }");
    expect(patched).toContain('throw new GradleException');
    // An APK is how a build is handed to somebody to try, so that one is only
    // warned about — a hard failure there would break every test build.
    expect(patched).toContain('DEBUG-SIGNED. Sideload only.');
  });

  it('declares the key at project scope, where the guard can also read it', () => {
    // The bug this pins: declared with `def` inside `android { }`, the flag is a
    // local of that closure, and the task-graph guard at the foot of the file
    // cannot see it. Gradle fails at configuration time — "Could not get unknown
    // property 'wavesHasUploadKey'" — before any task runs, so a passing string
    // assertion above proves nothing about whether the build works.
    expect(patched).toContain('ext.wavesHasUploadKey');
    expect(patched).not.toMatch(/^\s+def wavesHasUploadKey/m);
    // Declared above `android {`, and read below it in both places.
    const declared = patched.indexOf('ext.wavesHasUploadKey =');
    expect(declared).toBeGreaterThan(-1);
    expect(declared).toBeLessThan(patched.indexOf('android {'));
    expect(declared).toBeLessThan(patched.indexOf('signingConfig wavesHasUploadKey'));
    expect(declared).toBeLessThan(patched.indexOf('gradle.taskGraph.whenReady'));
  });

  it('is idempotent, because prebuild is not guaranteed to run once', () => {
    expect(patchBuildGradle(patched)).toBe(patched);
  });

  it('stands down on EAS, where the keystore is not ours to install', () => {
    // The bug this pins: EAS holds the key and patches the stock
    // `signingConfigs.release` to reach it. Patch the file first and that block
    // is ours, guarded by a `wavesHasUploadKey` that is false on a hosted
    // builder — so the guard stopped `bundleRelease` with a message about
    // gradle properties nobody can set there. Build 2362155a died exactly that
    // way. On EAS the plugin returns the config untouched, leaving Expo's own
    // template for EAS to sign.
    const config = { name: 'Waves' };
    const before = process.env.EAS_BUILD;
    try {
      process.env.EAS_BUILD = 'true';
      expect(withReleaseSigning(config)).toBe(config);
    } finally {
      if (before === undefined) delete process.env.EAS_BUILD;
      else process.env.EAS_BUILD = before;
    }
  });

  it('refuses to patch a template it does not recognise', () => {
    // The point of the whole file: a template Expo has changed must stop the
    // prebuild, not quietly leave the release build debug-signed.
    expect(() => patchBuildGradle('android {\n}\n')).toThrow(/signingConfigs/);
    expect(() =>
      patchBuildGradle(TEMPLATE.replace('            // Caution!', '            // Note:')),
    ).toThrow(/release buildType/);
  });
});
