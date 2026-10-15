/**
 * Store links for the referral landing page.
 *
 * Google Play keeps whatever follows `referrer=` with the install and gives it
 * back to the app on first launch (the Install Referrer API), which is how a
 * friend's code survives the trip through the store. The app reads
 * `waves_ref=<CODE>` out of it. The App Store has no such thing; there the
 * page shows the code to copy instead.
 */

/** The Android application id, as in `app.json`. */
export const ANDROID_PACKAGE = 'app.waves.mobile';
export const APP_STORE_URL = 'https://apps.apple.com/app/id6813446645';

/** Same key the app parses in `referralCodeFromInstallReferrer`. */
export const INSTALL_REFERRER_KEY = 'waves_ref';

/** The Play Store page, carrying a referral code when there is one. */
export function playStoreUrl(code?: string | null): string {
  const base = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;
  if (!code) return base;
  return `${base}&referrer=${encodeURIComponent(`${INSTALL_REFERRER_KEY}=${code}`)}`;
}
