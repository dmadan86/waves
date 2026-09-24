/**
 * Adopt the UIScene life cycle on iOS.
 *
 * iOS 27 refuses to launch an app that has not: UIKit traps in
 * `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption` the moment the
 * first scene connects, before a line of JS has run. Waves died on launch on an
 * iPad the day it updated — SIGTRAP, no log. iOS 26 only warned.
 *
 * Expo SDK 57 ships the delegate that does the work (`ExpoAppSceneDelegate`:
 * it makes the window from the connecting scene, starts React Native into it,
 * and forwards URLs, universal links and quick actions), but its bare template
 * — up to 57.0.27 — still generates the old app-delegate-owns-the-window shape.
 * So this plugin makes the three changes the template does not:
 *
 *   1. `Info.plist` declares a scene manifest naming `SceneDelegate`;
 *   2. `SceneDelegate.swift`, an empty `ExpoAppSceneDelegate` subclass, is
 *      written into the app target;
 *   3. `AppDelegate.swift` stops creating a window and starting React Native —
 *      the scene delegate does both now — and declares itself an
 *      `ExpoReactNativeFactoryProvider`, which is how the scene delegate finds
 *      the factory `didFinishLaunching` still creates.
 *
 * **Registered first in `app.json`, so it runs last** (plugins within one mod
 * run in reverse order — see `withForegroundOnlyLocation`). That matters for
 * the AppDelegate: `@react-native-firebase/app` inserts its `FirebaseApp.configure()`
 * block next to the lines this removes, and must find them there first.
 *
 * Every edit is checked. If the template's AppDelegate ever stops looking the
 * way this expects, prebuild fails here, loudly, rather than shipping a binary
 * that launches on nothing newer than iOS 26. When Expo's own template adopts
 * scenes, delete this plugin.
 */

const fs = require('fs');
const path = require('path');
const {
  IOSConfig,
  withAppDelegate,
  withDangerousMod,
  withInfoPlist,
  withXcodeProject,
} = require('expo/config-plugins');

const SCENE_DELEGATE_FILE = 'SceneDelegate.swift';

const SCENE_DELEGATE_SOURCE = `internal import Expo

/// The UIScene delegate iOS 27 requires. All the work — the window, starting
/// React Native, forwarding URLs and quick actions — is Expo's
/// \`ExpoAppSceneDelegate\`. Written by \`plugins/withSceneLifecycle.js\`.
class SceneDelegate: ExpoAppSceneDelegate {}
`;

function withSceneManifest(config) {
  return withInfoPlist(config, (config) => {
    config.modResults.UIApplicationSceneManifest = {
      // One window. Waves has never been a multi-window iPad app.
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };
    return config;
  });
}

function withSceneDelegateFile(config) {
  config = withDangerousMod(config, [
    'ios',
    (config) => {
      const projectName = IOSConfig.XcodeUtils.getProjectName(config.modRequest.projectRoot);
      const file = path.join(
        config.modRequest.platformProjectRoot,
        projectName,
        SCENE_DELEGATE_FILE,
      );
      fs.writeFileSync(file, SCENE_DELEGATE_SOURCE);
      return config;
    },
  ]);
  return withXcodeProject(config, (config) => {
    const projectName = IOSConfig.XcodeUtils.getProjectName(config.modRequest.projectRoot);
    const filepath = path.join(projectName, SCENE_DELEGATE_FILE);
    if (!config.modResults.hasFile(filepath)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath,
        groupName: projectName,
        project: config.modResults,
      });
    }
    return config;
  });
}

/** Swap `from` for `to` exactly once, or fail the prebuild saying which edit. */
function replaceOnce(source, from, to, what) {
  const matches = source.match(from);
  if (!matches || matches.length === 0) {
    throw new Error(
      `withSceneLifecycle: could not ${what} in AppDelegate.swift — the Expo template ` +
        `has changed shape. Update plugins/withSceneLifecycle.js (or delete it if the ` +
        `template now adopts the scene life cycle itself).`,
    );
  }
  return source.replace(from, to);
}

/**
 * The AppDelegate edit, on its own so a test can hold it to the template's
 * current shape (`test/sceneLifecycle.test.ts`). Idempotent: an AppDelegate
 * that already provides the factory is returned untouched.
 */
function patchAppDelegate(source) {
  if (source.includes('ExpoReactNativeFactoryProvider')) return source;

  source = replaceOnce(
    source,
    /class AppDelegate: ExpoAppDelegate \{/,
    'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {',
    'declare AppDelegate an ExpoReactNativeFactoryProvider',
  );
  // The scene delegate makes the window from the connecting UIWindowScene.
  source = replaceOnce(
    source,
    /\n[ \t]*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n/,
    '\n',
    'remove the app delegate creating its own window',
  );
  // …and starts React Native into it, with launch options rebuilt from the
  // scene's connection options so a cold-start deep link still arrives.
  source = replaceOnce(
    source,
    /\n[ \t]*factory\.startReactNative\(\s*withModuleName: "main",\s*in: window,\s*launchOptions: launchOptions\)\n/,
    '\n',
    'remove the app delegate starting React Native',
  );
  return source;
}

function withSceneAppDelegate(config) {
  return withAppDelegate(config, (config) => {
    if (config.modResults.language !== 'swift') {
      throw new Error('withSceneLifecycle: expected a Swift AppDelegate');
    }
    config.modResults.contents = patchAppDelegate(config.modResults.contents);
    return config;
  });
}

module.exports = function withSceneLifecycle(config) {
  config = withSceneManifest(config);
  config = withSceneDelegateFile(config);
  config = withSceneAppDelegate(config);
  return config;
};

module.exports.patchAppDelegate = patchAppDelegate;
