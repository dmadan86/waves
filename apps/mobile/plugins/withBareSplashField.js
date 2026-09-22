/**
 * Make the native splash the bare field it is documented to be.
 *
 * `app.json` gives `expo-splash-screen` a colour and no image, on the
 * understanding that the launch opens on a flat field of the brand purple and
 * the mark then draws itself on in JS (`AnimatedSplash`, `WaveMark`). That
 * understanding was wrong about Android.
 *
 * Android 12's splash screen API does not treat "no icon" as "no icon". When
 * `windowSplashScreenAnimatedIcon` is unset it falls back to the activity's
 * `android:icon` — `@mipmap/ic_launcher`, the finished launcher tile with the
 * mark already on it. So the launch spent about three quarters of a second
 * showing a finished logo, then dissolved it and drew the same logo again at a
 * different size on a different background. That is precisely the seam the
 * splash was rebuilt to remove, wearing a different hat.
 *
 * A transparent ColorDrawable is a legal icon and draws nothing, which is the
 * only way to say "nothing" to this API.
 *
 * `android/` is generated and untracked, so hand-editing `styles.xml` lasts
 * until the next prebuild. This runs every time.
 *
 * If a mark is ever wanted in the native half again, delete this plugin AND
 * give `AnimatedSplash` its static mark back — the two have to agree, or the
 * seam comes back.
 */

const { withAndroidStyles } = require('expo/config-plugins');

const SPLASH_STYLE = 'Theme.App.SplashScreen';
const ICON_ATTR = 'windowSplashScreenAnimatedIcon';

module.exports = function withBareSplashField(config) {
  return withAndroidStyles(config, (cfg) => {
    const styles = cfg.modResults.resources?.style ?? [];
    const splash = styles.find((s) => s.$?.name === SPLASH_STYLE);
    // No splash theme means expo-splash-screen is not configured at all, which
    // is a different problem than this one and not ours to invent a fix for.
    if (!splash) return cfg;

    splash.item = splash.item ?? [];
    const existing = splash.item.find((i) => i.$?.name === ICON_ATTR);
    if (existing) {
      existing._ = '@android:color/transparent';
    } else {
      splash.item.push({ $: { name: ICON_ATTR }, _: '@android:color/transparent' });
    }

    return cfg;
  });
};
