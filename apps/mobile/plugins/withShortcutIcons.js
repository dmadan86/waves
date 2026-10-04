/**
 * Icons for the app-icon long-press menu (Android App Shortcuts).
 *
 * Today the three shortcuts — add, scan, voice — show no icon at all on
 * Android: `expo-quick-actions` sets them as *dynamic* shortcuts
 * (`ShortcutManager.dynamicShortcuts`), and its native module resolves an
 * item's `icon` string by looking it up as the name of a drawable resource in
 * the app's own `res/` (see `loadIconRes` in `ExpoQuickActionsModule.kt`). The
 * values `src/lib/quickActions.ts` published — `symbol:plus`, `symbol:camera`,
 * `symbol:mic` — are iOS SF Symbol names, which that lookup never matches, so
 * Android silently falls back to no icon.
 *
 * Why a config plugin rather than checked-in native files: `android/` is
 * generated and gitignored (CNG / prebuild), so a drawable dropped there by
 * hand is erased on the next `expo prebuild`. These three are therefore
 * emitted here so prebuild reproduces them, every time. Modelled structurally
 * on `withWavesWidgets.js`, the repo's other plugin that writes `res/`.
 *
 * Each icon is a single flat vector drawable — a brand-purple rounded-square
 * badge with a white glyph — rather than the `<adaptive-icon>` two-layer
 * format the app's own launcher icon uses. That split is deliberate: Android's
 * shortcuts guide
 * (https://developer.android.com/develop/ui/views/launch/shortcuts/creating-shortcuts)
 * says a shortcut icon should already be "a solid color backdrop that fills
 * the entire visible area, with your icon shape inset within the 44x44dp safe
 * zone" — the system does not run shortcut icons through adaptive-icon
 * masking the way it does the launcher icon, so a pre-shaped badge is the
 * correct (and simpler) format here, not a workaround.
 *
 * The three glyphs are the same path data as the home-screen widgets' icons
 * (`withWavesWidgets.js`'s `ICONS`), so a long-press menu and a widget read as
 * the same visual language. Each is drawn in a 24x24 box, as the Material
 * icon set draws it, then scaled 1.8333x (44/24) and shifted by (2, 2) via a
 * `<group>` transform — landing it exactly inside the 44dp safe zone of the
 * 48dp canvas — rather than hand-transforming the path coordinates.
 */

const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

/** Brand purple — the same value as `android.adaptiveIcon.backgroundColor` in app.json. */
const BADGE_COLOR = '#6C4EE3';

/** A 48dp canvas, rounded-square badge filling it, radius chosen to read as a squircle. */
const BADGE_BACKGROUND_PATH =
  'M14,0h20a14,14 0,0 1,14 14v20a14,14 0,0 1,-14 14h-20a14,14 0,0 1,-14 -14v-20a14,14 0,0 1,14 -14z';

/** Glyph path data, each drawn in a 24x24 box — identical to `withWavesWidgets.js`'s `ICONS`. */
const GLYPHS = {
  ic_shortcut_add: 'M11,5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
  ic_shortcut_scan:
    'M4,4h4v2H6v2H4zM16,4h4v4h-2V6h-2zM4,16h2v2h2v2H4zM18,16h2v4h-4v-2h2zM7,11h10v2H7z',
  ic_shortcut_voice:
    'M12,3a3,3 0,0 1,3 3v6a3,3 0,0 1,-6 0V6a3,3 0,0 1,3 -3zM5,11h2a5,5 0,0 0,10 0h2a7,7 0,0 1,-6 6.92V21h-2v-3.08A7,7 0,0 1,5 11z',
};

/** 44/24 — the glyph's 24x24 box scaled up to fill the 48dp canvas' 44dp safe zone. */
const GLYPH_SCALE = '1.833333';

const shortcutIconXml = (glyphPath) => `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
  android:width="48dp" android:height="48dp"
  android:viewportWidth="48" android:viewportHeight="48">
  <path android:fillColor="${BADGE_COLOR}" android:pathData="${BADGE_BACKGROUND_PATH}" />
  <group android:translateX="2" android:translateY="2" android:scaleX="${GLYPH_SCALE}" android:scaleY="${GLYPH_SCALE}">
    <path android:fillColor="#FFFFFF" android:pathData="${glyphPath}" />
  </group>
</vector>
`;

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function writeNativeSources(projectRoot) {
  const drawableDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'res', 'drawable');
  for (const [name, glyphPath] of Object.entries(GLYPHS)) {
    writeFile(path.join(drawableDir, `${name}.xml`), shortcutIconXml(glyphPath));
  }
}

module.exports = function withShortcutIcons(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      writeNativeSources(cfg.modRequest.projectRoot);
      return cfg;
    },
  ]);
};

// Exposed for the plugin's unit test (test/shortcutIconsPlugin.test.ts). Not part
// of the plugin's runtime contract.
module.exports._internals = {
  BADGE_COLOR,
  BADGE_BACKGROUND_PATH,
  GLYPHS,
  GLYPH_SCALE,
  shortcutIconXml,
  writeNativeSources,
};
