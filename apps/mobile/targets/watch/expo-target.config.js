/**
 * The Apple Watch companion — a watchOS SwiftUI app target.
 *
 * A thin client: it sends quick-add / voice / request-recent intents to the
 * paired phone over WatchConnectivity and renders what the phone relays back
 * (see `@waves/core`'s relay contract and `src/lib/watch/bridge.tsx`). No ledger
 * logic lives here. The Android sibling is the `:wear` module emitted by
 * plugins/withWavesWear.js; the shared transport is the WavesWatch Expo module.
 *
 * **`name` is the Xcode target, not the app's name, and it may not be `Waves`.**
 * A watchOS app target builds a `.app` like any other, so a target named `Waves`
 * here produced a second `Waves.app` alongside the phone app's and the build
 * died before compiling a line:
 *
 *     error: Multiple commands produce '…/Debug-iphonesimulator/Waves.app'
 *
 * `displayName` is the one users read — on the watch face and in the Watch app's
 * list — so the rename costs nothing visible. `WavesWatchApp` rather than
 * `WavesWatch` because `modules/waves-watch` already vends a pod by that name
 * into the same workspace.
 *
 * The bundle id is pinned instead of derived. A leading dot means "append to the
 * main app's", giving `app.wavs.mobile.watch` — which is what is registered on
 * the Apple Developer portal and what EAS holds a provisioning profile for.
 * Letting it follow the target name would have silently asked for a new,
 * unprovisioned identifier.
 *
 * **A watch app needs its own icon.** It is a `.app`, not an extension, so it
 * carries its own asset catalog and App Store Connect rejects the upload
 * without one — `90713: A value for the Info.plist key 'CFBundleIconName' is
 * missing in the bundle 'app.wavs.mobile.watch'` and `90391: No icons found for
 * watch application`. Nothing in the build warns first: it compiles, archives
 * and signs, and only the validator on Apple's side objects. Pointing `icon` at
 * the phone app's own 1024px artwork is what generates the target's
 * `AppIcon.appiconset` and sets `ASSETCATALOG_COMPILER_APPICON_NAME`; the watch
 * and the phone are the same product and should look it.
 *
 * Verified on a Mac with Xcode 27: the two Swift files typecheck against the
 * watchOS SDK, and the project builds with one `Waves.app` in it.
 *
 * @type {import('@bacons/apple-targets/app.plugin').Config}
 */
module.exports = {
  type: 'watch',
  name: 'WavesWatchApp',
  displayName: 'Waves',
  bundleIdentifier: '.watch',
  icon: '../../assets/images/icon.png',
  deploymentTarget: '10.0',
  colors: {
    $accent: '#7A5AF8',
  },
};
