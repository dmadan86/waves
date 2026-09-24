/**
 * iOS 27 launches only apps that adopt the UIScene life cycle, and the plugin
 * that adopts it for Waves still fits the template it edits.
 *
 * `withSceneLifecycle` rewrites Expo's generated `AppDelegate.swift` by quoting
 * it, like `withReleaseSigning` does `build.gradle`, and the failure it guards
 * against is just as silent: an Expo upgrade rewords the template, the edit
 * stops matching, and the app goes back to crashing on launch on iOS 27 while
 * the build looks fine. So every edit throws when its anchor is gone, and these
 * tests prove that it still does.
 *
 * The fixture is the AppDelegate prebuild produces before this plugin runs —
 * Expo's template plus `@react-native-firebase`'s block — kept here rather than
 * read off `ios/` (gitignored, so CI has none).
 */

import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { patchAppDelegate } = require('../plugins/withSceneLifecycle.js') as {
  patchAppDelegate: (source: string) => string;
};

const TEMPLATE = `internal import Expo
import FirebaseCore
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
// @generated begin @react-native-firebase/app-check - expo prebuild (DO NOT MODIFY) sync-cf2eb2cc4ab0c44de03d7c0dddc7165fa89d986f
RNFBAppCheckModule.sharedInstance()
    FirebaseApp.configure()
// @generated end @react-native-firebase/app-check
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

}
`;

describe('the AppDelegate under the scene life cycle', () => {
  const patched = patchAppDelegate(TEMPLATE);

  it('provides the React Native factory the scene delegate starts from', () => {
    expect(patched).toContain(
      'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {',
    );
    expect(patched).toContain('reactNativeFactory = factory');
  });

  it('no longer makes its own window or starts React Native', () => {
    expect(patched).not.toContain('UIWindow(frame: UIScreen.main.bounds)');
    expect(patched).not.toContain('factory.startReactNative(');
  });

  it('keeps Firebase configured at launch', () => {
    expect(patched).toContain('FirebaseApp.configure()');
    expect(patched).toContain('RNFBAppCheckModule.sharedInstance()');
  });

  it('changes nothing the second time', () => {
    expect(patchAppDelegate(patched)).toBe(patched);
  });

  it('fails the prebuild when the template no longer looks like this', () => {
    const reworded = TEMPLATE.replace('window = UIWindow(frame: UIScreen.main.bounds)', '');
    expect(() => patchAppDelegate(reworded)).toThrow(/withSceneLifecycle: could not remove/);
  });
});
