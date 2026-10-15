/**
 * `react-native-google-mobile-ads` is loaded lazily (lib/adsSdk.ts) and typed by
 * the small interface in lib/rewardedAd.ts, so the rest of the app never depends
 * on the package's own types — and a checkout without the package installed
 * still type-checks. An ambient module declaration wins over resolution.
 */
declare module 'react-native-google-mobile-ads';
