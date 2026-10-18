/**
 * iOS Share Extension: puts Waves in the share sheet for photos.
 *
 * Picking a photo anywhere and tapping Share -> Waves hands the image to this
 * extension (ShareViewController.swift). It writes the file into the App Group
 * container (`group.app.wavs.mobile`, declared in app.json
 * `ios.entitlements`; apple-targets copies it onto this target) and opens the
 * app at `waves://share-receipt`. The app's WavesShare module then moves the
 * file into its cache and JS routes it into add-expense (lib/sharedReceipt.ts).
 *
 * The bundle id is pinned (`app.wavs.mobile.share`) so it is a stable,
 * registrable identifier. It is NEW: the next EAS iOS build must create its
 * provisioning profile (and enable the App Groups capability on it).
 *
 * @type {import('@bacons/apple-targets/app.plugin').Config}
 */
module.exports = {
  type: 'share',
  name: 'WavesShare',
  displayName: 'Waves',
  bundleIdentifier: '.share',
  deploymentTarget: '15.1',
  frameworks: ['UniformTypeIdentifiers'],
};
