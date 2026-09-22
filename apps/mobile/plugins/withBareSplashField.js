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
 * It does it twice, on purpose.
 *
 * Rewriting the style is the direct statement, but it does not always survive:
 * `expo-splash-screen` writes that same attribute, and on a clean prebuild its
 * write landed after ours — leaving the theme pointing at
 * `@drawable/splashscreen_logo`, a drawable that only exists when an image is
 * configured, which is exactly what this app does not do. The build then fails
 * at resource linking, and only on a *clean* prebuild: an `android/` directory
 * generated before the reference appeared keeps working, so the failure waits
 * for a fresh machine or a CI runner.
 *
 * So the drawable is written as well. A transparent shape under the name the
 * theme expects makes the reference resolve however the ordering falls, and
 * draws nothing either way. Belt and braces, because the cost of the braces is
 * eleven lines and the cost of being wrong is a build that only breaks
 * somewhere else.
 *
 * `android/` is generated and untracked, so hand-editing `styles.xml` lasts
 * until the next prebuild. This runs every time.
 *
 * If a mark is ever wanted in the native half again, delete this plugin AND
 * give `AnimatedSplash` its static mark back — the two have to agree, or the
 * seam comes back.
 */

const fs = require('node:fs');
const path = require('node:path');

const { withAndroidStyles, withDangerousMod } = require('expo/config-plugins');

const SPLASH_STYLE = 'Theme.App.SplashScreen';
const ICON_ATTR = 'windowSplashScreenAnimatedIcon';

/** The name `expo-splash-screen`'s theme refers to, whether or not it made one. */
const LOGO_DRAWABLE = 'splashscreen_logo.xml';

/** A shape with a transparent fill: a legal drawable that paints nothing. */
const TRANSPARENT_DRAWABLE = `<?xml version="1.0" encoding="utf-8"?>
<!-- Written by plugins/withBareSplashField.js. The splash theme refers to this
     name; the app ships no splash image, so it has to exist and draw nothing. -->
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
  <solid android:color="@android:color/transparent" />
</shape>
`;

function withTransparentSplashLogo(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const drawables = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'drawable',
      );
      fs.mkdirSync(drawables, { recursive: true });
      fs.writeFileSync(path.join(drawables, LOGO_DRAWABLE), TRANSPARENT_DRAWABLE, 'utf8');
      return cfg;
    },
  ]);
}

module.exports = function withBareSplashField(config) {
  return withTransparentSplashLogo(
    withAndroidStyles(config, (cfg) => {
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
    }),
  );
};
