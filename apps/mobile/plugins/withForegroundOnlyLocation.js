/**
 * Declare only the location permission this app actually asks for.
 *
 * `src/lib/location.ts` calls `getForegroundPermissionsAsync` and
 * `requestForegroundPermissionsAsync`, and nothing else — a place is attached
 * to an expense while the user is looking at the screen, and there is no
 * background task, no geofence and no `UIBackgroundModes: location`. "When in
 * use" is the whole of what Waves needs.
 *
 * `expo-location`'s own config plugin does not agree. It writes all three iOS
 * keys unconditionally — `NSLocationWhenInUseUsageDescription`,
 * `NSLocationAlwaysUsageDescription` and
 * `NSLocationAlwaysAndWhenInUseUsageDescription` — falling back to a generic
 * "Allow Waves to access your location" for whichever ones the app config does
 * not supply. Leaving the Always strings out of `app.json` therefore does not
 * remove the keys; it only replaces our copy with theirs.
 *
 * A binary that declares Always location while never requesting it is a
 * standing App Review question — the reviewer sees the app asking for more than
 * it uses, and the answer ("it doesn't, the library put that there") has to be
 * made in the review notes rather than in the build. It is also simply untrue
 * of this app. So the two Always keys are stripped back out after
 * `expo-location` has written them.
 *
 * **This plugin is registered first in `app.json`, and that is what makes it
 * run last.** `withMod` wraps: each newly registered mod becomes the outer
 * function and awaits the one registered before it, so within a single mod
 * (`ios.infoPlist`) the plugins run in reverse of the order they are listed.
 * Registered after `expo-location`, this one ran against an Info.plist with no
 * `NSLocation*` keys in it yet and deleted nothing. Registered before it, it
 * sees the finished plist. Moving it down the list silently stops it working —
 * the prebuild still succeeds and the keys come back.
 *
 * If Waves ever does need background location, delete this plugin rather than
 * working around it: the keys, the entitlement and the review justification all
 * belong together.
 */

const { withInfoPlist } = require('expo/config-plugins');

/** The keys that describe a permission this app never requests. */
const ALWAYS_KEYS = [
  'NSLocationAlwaysUsageDescription',
  'NSLocationAlwaysAndWhenInUseUsageDescription',
];

module.exports = function withForegroundOnlyLocation(config) {
  return withInfoPlist(config, (cfg) => {
    for (const key of ALWAYS_KEYS) delete cfg.modResults[key];
    return cfg;
  });
};
