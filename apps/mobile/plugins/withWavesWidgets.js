/**
 * Home-screen launcher widgets for Android.
 *
 * One widget, on the white-glass card with the purple "W" tile:
 *
 *   - Search (4x2): a "What did you spend on?" pill with a mic, over category
 *     chips (Food, Travel, Shopping, …) that open quick add with that category
 *     already chosen.
 *
 * Every tap fires a deep link the app already resolves (`/capture`,
 * `/capture?category=…`, routed through `+native-intent.ts`) — except voice, which goes through the
 * transparent `VoiceCaptureActivity` trampoline below so speech is captured
 * over the home screen without a cold start. The widget holds no data and runs
 * no timeline; it is a pure shortcut.
 *
 * Why a config plugin rather than checked-in native files: `android/` is
 * generated and gitignored (CNG / prebuild), so anything dropped there by hand
 * is erased on the next `expo prebuild`. Every widget source — the manifest
 * receivers, the `res/` xml/layout/drawable/values, and the Kotlin providers —
 * is therefore emitted here so prebuild reproduces it.
 *
 * Layouts use only what RemoteViews can inflate (LinearLayout, FrameLayout,
 * ImageView, TextView); icons are vector drawables and every rounded surface is
 * a shape drawable. Colours live in values / values-night, so the widgets
 * follow the system theme with no code.
 *
 * The iOS half of this feature lives in `targets/widgets` (@bacons/apple-targets).
 */

const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('expo/config-plugins');

/** `scheme` matches the primary app scheme in app.json. */
const SCHEME = 'waves';

/**
 * The deep links each tap fires.
 */
const LINKS = {
  manual: `${SCHEME}:///capture`,
  category: (id) => `${SCHEME}:///capture?category=${id}`,
};

/** Marks a tap that launches the voice trampoline instead of a deep link. */
const VOICE = 'voice';

/** Brand purple — `color.brand` in packages/ui/src/themes.ts (light). */
const BRAND = '#6C4EE3';

/**
 * Every string the widgets draw, as Android string resources. English only:
 * the app's own translations live in JS (src/i18n), which a launcher cannot
 * read, and the plugin has never emitted translated `values-*` folders.
 */
const STRINGS = {
  waves_widget_add_expense: 'Add expense',
  waves_widget_search_hint: 'What did you spend on?',
  waves_widget_voice: 'Voice',
  waves_widget_food: 'Food',
  waves_widget_travel: 'Travel',
  waves_widget_shopping: 'Shopping',
  waves_widget_more: 'More categories',
  waves_widget_search_label: 'Waves — Search',
  waves_widget_search_description: 'Start an expense from a category in one tap',
};

// An Android string resource: XML-escape, then the resource format's own
// escapes. The backslash goes first so the ones added for quotes survive.
const escapeXml = (s) =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"');

const STRINGS_XML = `<?xml version="1.0" encoding="utf-8"?>
<resources>
${Object.entries(STRINGS)
  .map(([name, value]) => `  <string name="${name}">${escapeXml(value)}</string>`)
  .join('\n')}
</resources>
`;

// --- colours ------------------------------------------------------------------

/**
 * Light and dark values, from the app theme (packages/ui): the pastel tint
 * family for the buttons and tiles, the brand for the logo, ink and muted ink
 * for text. The card is white at 92% so the wallpaper reads through it like
 * glass; night drops it to the app's dark surface.
 */
const COLORS = {
  waves_widget_card: ['#EBFFFFFF', '#EB16162A'],
  waves_widget_card_stroke: ['#B3FFFFFF', '#402A2A47'],
  waves_widget_pill: ['#FFFFFF', '#1E1E36'],
  waves_widget_chip: ['#F3F1FB', '#2A2A47'],
  waves_widget_text: ['#14142B', '#F4F3FF'],
  waves_widget_text_muted: ['#54566B', '#9E9EB8'],
  waves_widget_logo: [BRAND, BRAND],
  waves_widget_on_brand: ['#FFFFFF', '#FFFFFF'],
  waves_widget_sky_ink: ['#1D68A3', '#AFD8F7'],
  waves_widget_peach_ink: ['#B8690F', '#F7CFA2'],
  waves_widget_pink_ink: ['#964450', '#FFC2CA'],
};

const colorsXml = (index) => `<?xml version="1.0" encoding="utf-8"?>
<resources>
${Object.entries(COLORS)
  .map(([name, pair]) => `  <color name="${name}">${pair[index]}</color>`)
  .join('\n')}
</resources>
`;
const COLORS_LIGHT = colorsXml(0);
const COLORS_DARK = colorsXml(1);

// --- drawables ----------------------------------------------------------------

const roundedRect = (color, radius, stroke) => `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
  <solid android:color="${color}" />
  <corners android:radius="${radius}dp" />${
    stroke ? `\n  <stroke android:width="1dp" android:color="${stroke}" />` : ''
  }
</shape>
`;

/** A 24dp Material-style glyph. The ImageView tints it, so one shape serves every colour. */
const vec = (pathData) => `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
  android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
  <path android:fillColor="#FFFFFFFF" android:pathData="${pathData}" />
</vector>
`;

/** The purple "W" logo tile: a brand rounded square with a white stroked W. */
const LOGO = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
  android:width="40dp" android:height="40dp" android:viewportWidth="40" android:viewportHeight="40">
  <path android:fillColor="@color/waves_widget_logo"
    android:pathData="M11,0h18a11,11 0,0 1,11 11v18a11,11 0,0 1,-11 11h-18a11,11 0,0 1,-11 -11v-18a11,11 0,0 1,11 -11z" />
  <path android:strokeColor="@color/waves_widget_on_brand" android:strokeWidth="3.4"
    android:strokeLineCap="round" android:strokeLineJoin="round"
    android:pathData="M10.5,13L15.25,27L20,16.5L24.75,27L29.5,13" />
</vector>
`;

const DRAWABLES = {
  widget_card: roundedRect('@color/waves_widget_card', 24, '@color/waves_widget_card_stroke'),
  widget_pill: roundedRect('@color/waves_widget_pill', 22),
  widget_chip: roundedRect('@color/waves_widget_chip', 18),
  ic_widget_logo: LOGO,
  ic_widget_mic: vec(
    'M12,3a3,3 0,0 1,3 3v6a3,3 0,0 1,-6 0V6a3,3 0,0 1,3 -3zM5,11h2a5,5 0,0 0,10 0h2a7,7 0,0 1,-6 6.92V21h-2v-3.08A7,7 0,0 1,5 11z',
  ),
  ic_widget_food: vec(
    'M11,9H9V2H7v7H5V2H3v7c0,2.12 1.66,3.84 3.75,3.97V22h2.5v-9.03C11.34,12.84 13,11.12 13,9V2h-2V9zM16,6v8h2.5v8H21V2C18.24,2 16,4.24 16,6z',
  ),
  ic_widget_travel: vec(
    'M18.92,6.01C18.72,5.42 18.16,5 17.5,5h-11c-0.66,0 -1.21,0.42 -1.42,1.01L3,12v8c0,0.55 0.45,1 1,1h1c0.55,0 1,-0.45 1,-1v-1h12v1c0,0.55 0.45,1 1,1h1c0.55,0 1,-0.45 1,-1v-8L18.92,6.01zM6.5,16C5.67,16 5,15.33 5,14.5S5.67,13 6.5,13S8,13.67 8,14.5S7.33,16 6.5,16zM17.5,16c-0.83,0 -1.5,-0.67 -1.5,-1.5s0.67,-1.5 1.5,-1.5s1.5,0.67 1.5,1.5S18.33,16 17.5,16zM5,11l1.5,-4.5h11L19,11H5z',
  ),
  ic_widget_shopping: vec(
    'M19,6h-2c0,-2.76 -2.24,-5 -5,-5S7,3.24 7,6H5C3.9,6 3.01,6.9 3.01,8L3,20c0,1.1 0.9,2 2,2h14c1.1,0 2,-0.9 2,-2V8C21,6.9 20.1,6 19,6zM12,3c1.66,0 3,1.34 3,3H9C9,4.34 10.34,3 12,3zM12,13c-2.76,0 -5,-2.24 -5,-5h2c0,1.66 1.34,3 3,3s3,-1.34 3,-3h2C17,10.76 14.76,13 12,13z',
  ),
  ic_widget_more: vec(
    'M6,10c-1.1,0 -2,0.9 -2,2s0.9,2 2,2 2,-0.9 2,-2 -0.9,-2 -2,-2zM18,10c-1.1,0 -2,0.9 -2,2s0.9,2 2,2 2,-0.9 2,-2 -0.9,-2 -2,-2zM12,10c-1.1,0 -2,0.9 -2,2s0.9,2 2,2 2,-0.9 2,-2 -0.9,-2 -2,-2z',
  ),
};

// --- the widget ---------------------------------------------------------

/** Search (4x2): the pill opens quick add, its mic opens voice, a chip presets a category. */
const SEARCH = {
  className: 'WavesSearchWidget',
  key: 'search',
  label: '@string/waves_widget_search_label',
  description: '@string/waves_widget_search_description',
  info: {
    minWidth: 250,
    minHeight: 110,
    minResizeWidth: 180,
    minResizeHeight: 90,
    cellsW: 4,
    cellsH: 2,
    resize: 'horizontal|vertical',
  },
  pill: { id: 'widget_search_pill', target: LINKS.manual, requestCode: 31 },
  mic: { id: 'widget_search_mic', target: VOICE, requestCode: 32 },
  // Ids match `CategoryId` in packages/core; tints match each category's own.
  chips: [
    {
      id: 'widget_chip_food',
      category: 'food',
      icon: 'ic_widget_food',
      tint: 'waves_widget_peach_ink',
      label: 'waves_widget_food',
      requestCode: 33,
    },
    {
      id: 'widget_chip_travel',
      category: 'travel',
      icon: 'ic_widget_travel',
      tint: 'waves_widget_sky_ink',
      label: 'waves_widget_travel',
      requestCode: 34,
    },
    {
      id: 'widget_chip_shopping',
      category: 'shopping',
      icon: 'ic_widget_shopping',
      tint: 'waves_widget_pink_ink',
      label: 'waves_widget_shopping',
      requestCode: 35,
    },
  ],
  // "…" — every other category is one tap away in quick add's own picker.
  more: { id: 'widget_chip_more', target: LINKS.manual, requestCode: 36 },
  root: { id: 'widget_root', target: LINKS.manual, requestCode: 30 },
};

const WIDGETS = [SEARCH];

/** Every tap target a widget wires, root first. */
function tapsOf(widget) {
  return [
    widget.root,
    widget.pill,
    widget.mic,
    ...widget.chips.map((c) => ({ ...c, target: LINKS.category(c.category) })),
    widget.more,
  ];
}

/**
 * The widgets earlier versions shipped and this one does not: three 1x1
 * launchers, then the compact (4x1) and action-grid (4x2) widgets. A
 * non-clean prebuild merges into the existing android/, so their
 * receivers and sources would linger and point at resources that are gone;
 * they are removed explicitly.
 */
const RETIRED = [
  { className: 'QuickExpenseWidget', key: 'quick' },
  { className: 'ScanReceiptWidget', key: 'scan' },
  { className: 'VoiceWidget', key: 'voice' },
  { className: 'WavesCompactWidget', key: 'compact' },
  { className: 'WavesHomeWidget', key: 'home' },
];
const RETIRED_DRAWABLES = [
  'widget_background',
  'widget_home_container',
  'widget_home_pill',
  'widget_home_tile',
  'ic_widget_add',
  'ic_widget_scan',
  'ic_widget_voice',
  'ic_widget_mark',
  'ic_widget_waveform',
  'ic_widget_photo',
  'widget_tile_lilac',
  'widget_tile_sky',
  'widget_tile_peach',
  'widget_tile_mint',
  'widget_circle_lilac',
  'widget_circle_sky',
  'widget_circle_brand_soft',
  'widget_circle_chip',
  'ic_widget_camera',
  'ic_widget_plus',
  'ic_widget_receipt',
  'ic_widget_settings',
];

// --- provider info --------------------------------------------------------------

const infoXml = (widget) => {
  const i = widget.info;
  return `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
  android:minWidth="${i.minWidth}dp"
  android:minHeight="${i.minHeight}dp"
  android:minResizeWidth="${i.minResizeWidth}dp"
  android:minResizeHeight="${i.minResizeHeight}dp"
  android:targetCellWidth="${i.cellsW}"
  android:targetCellHeight="${i.cellsH}"
  android:resizeMode="${i.resize}"
  android:widgetCategory="home_screen"
  android:updatePeriodMillis="0"
  android:description="${widget.description}"
  android:previewImage="@drawable/ic_widget_logo"
  android:previewLayout="@layout/widget_${widget.key}"
  android:initialLayout="@layout/widget_${widget.key}" />
`;
};

// --- layouts -----------------------------------------------------------------

const text = ({ str, size, color, bold, width = 'wrap_content', extra = '' }) => `<TextView
      android:layout_width="${width}"
      android:layout_height="wrap_content"
      android:text="@string/${str}"
      android:textColor="@color/${color}"
      android:textSize="${size}sp"${bold ? '\n      android:textStyle="bold"' : ''}
      android:maxLines="1"
      android:ellipsize="end"${extra} />`;

const ROOT_OPEN = (orientation, padding) => `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
  android:id="@+id/widget_root"
  android:layout_width="match_parent"
  android:layout_height="match_parent"
  android:orientation="${orientation}"
  android:gravity="center_vertical"
  android:padding="${padding}dp"
  android:background="@drawable/widget_card">`;

const searchLayoutXml = () => {
  const chip = (c) => `    <LinearLayout
      android:id="@+id/${c.id}"
      android:layout_width="0dp"
      android:layout_height="match_parent"
      android:layout_weight="1"
      android:layout_marginEnd="6dp"
      android:orientation="horizontal"
      android:gravity="center"
      android:paddingStart="6dp"
      android:paddingEnd="6dp"
      android:background="@drawable/widget_chip">
      <ImageView
        android:layout_width="16dp"
        android:layout_height="16dp"
        android:src="@drawable/${c.icon}"
        android:tint="@color/${c.tint}"
        android:importantForAccessibility="no" />
      ${text({ str: c.label, size: 12, color: 'waves_widget_text', extra: '\n      android:layout_marginStart="5dp"' })}
    </LinearLayout>`;
  return `${ROOT_OPEN('vertical', 10)}
  <LinearLayout
    android:id="@+id/${SEARCH.pill.id}"
    android:layout_width="match_parent"
    android:layout_height="0dp"
    android:layout_weight="1"
    android:orientation="horizontal"
    android:gravity="center_vertical"
    android:paddingStart="6dp"
    android:paddingEnd="4dp"
    android:background="@drawable/widget_pill"
    android:contentDescription="@string/waves_widget_add_expense">
    <ImageView
      android:layout_width="34dp"
      android:layout_height="34dp"
      android:src="@drawable/ic_widget_logo"
      android:importantForAccessibility="no" />
    ${text({ str: 'waves_widget_search_hint', size: 15, color: 'waves_widget_text_muted', width: '0dp', extra: '\n      android:layout_weight="1"\n      android:layout_marginStart="10dp"' })}
    <ImageView
      android:id="@+id/${SEARCH.mic.id}"
      android:layout_width="40dp"
      android:layout_height="40dp"
      android:padding="9dp"
      android:src="@drawable/ic_widget_mic"
      android:tint="@color/waves_widget_text"
      android:contentDescription="@string/waves_widget_voice" />
  </LinearLayout>
  <LinearLayout
    android:layout_width="match_parent"
    android:layout_height="0dp"
    android:layout_weight="1"
    android:layout_marginTop="8dp"
    android:orientation="horizontal">
${SEARCH.chips.map(chip).join('\n')}
    <FrameLayout
      android:id="@+id/${SEARCH.more.id}"
      android:layout_width="40dp"
      android:layout_height="match_parent"
      android:background="@drawable/widget_chip"
      android:contentDescription="@string/waves_widget_more">
      <ImageView
        android:layout_width="20dp"
        android:layout_height="20dp"
        android:layout_gravity="center"
        android:src="@drawable/ic_widget_more"
        android:tint="@color/waves_widget_text"
        android:importantForAccessibility="no" />
    </FrameLayout>
  </LinearLayout>
</LinearLayout>
`;
};

const LAYOUTS = {
  search: searchLayoutXml,
};

// --- Kotlin providers ----------------------------------------------------------

const kotlinProvider = (widget, pkg) => {
  const bindings = tapsOf(widget)
    .map(
      (tap) => `    views.setOnClickPendingIntent(
      R.id.${tap.id},
      PendingIntent.getActivity(context, ${tap.requestCode}, ${
        tap.target === VOICE ? 'voice(context)' : `deepLink(context, "${tap.target}")`
      }, FLAGS),
    )`,
    )
    .join('\n');
  return `package ${pkg}.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import ${pkg}.R

/**
 * The "${widget.key}" home-screen widget. Every tap fires a deep link the app
 * already routes, except voice, which launches VoiceCaptureActivity.
 * Generated by plugins/withWavesWidgets.js; do not edit under android/.
 */
class ${widget.className} : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) {
      val views = RemoteViews(context.packageName, R.layout.widget_${widget.key})
      bind(context, views)
      manager.updateAppWidget(id, views)
    }
  }

  private fun bind(context: Context, views: RemoteViews) {
${bindings}
  }

  private fun deepLink(context: Context, url: String) =
    Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
      setPackage(context.packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }

  private fun voice(context: Context) =
    Intent(context, VoiceCaptureActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

  companion object {
    // Immutable pending intents are mandatory from Android 12.
    private const val FLAGS = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
  }
}
`;
};

/**
 * The transparent trampoline every voice tap launches: it fires the platform
 * speech recogniser (offline-preferred, so the on-device model is used where the
 * network one is unreliable) over the home screen — no cold start, no splash —
 * then hands the transcript to the app on `${SCHEME}:///voice?heard=…`. A per-tap
 * `hn` nonce lets a warm voice screen re-read a fresh capture. No speech service
 * (or a cancel) falls back to opening the in-app mic.
 */
const trampolineActivity = (pkg) => `package ${pkg}.widget

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.speech.RecognizerIntent

/**
 * Instant voice capture for the ${SCHEME} widgets' mic buttons.
 * Generated by plugins/withWavesWidgets.js; do not edit under android/.
 */
class VoiceCaptureActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val recognize = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
      putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
    }
    try {
      startActivityForResult(recognize, REQUEST_SPEECH)
    } catch (e: Exception) {
      // No speech service on this device — open the in-app mic instead.
      openApp(null)
    }
  }

  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    if (requestCode != REQUEST_SPEECH) {
      finish()
      return
    }
    val heard =
      if (resultCode == RESULT_OK) {
        data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.trim()
      } else {
        null
      }
    openApp(if (heard.isNullOrEmpty()) null else heard)
  }

  private fun openApp(heard: String?) {
    val builder = Uri.parse("${SCHEME}:///voice").buildUpon()
    if (heard != null) {
      builder.appendQueryParameter("heard", heard)
      builder.appendQueryParameter("hn", System.currentTimeMillis().toString())
    }
    val intent =
      Intent(Intent.ACTION_VIEW, builder.build()).apply {
        setPackage(packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      }
    startActivity(intent)
    finish()
  }

  companion object {
    private const val REQUEST_SPEECH = 4201
  }
}
`;

// --- manifest -----------------------------------------------------------------

function addReceivers(androidManifest) {
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  application.receiver = (application.receiver ?? []).filter(
    (r) => !RETIRED.some((w) => r?.$?.['android:name'] === `.widget.${w.className}`),
  );

  for (const widget of WIDGETS) {
    const name = `.widget.${widget.className}`;
    const receiver = {
      $: { 'android:name': name, 'android:exported': 'true', 'android:label': widget.label },
      'intent-filter': [
        {
          action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }],
        },
      ],
      'meta-data': [
        {
          $: {
            'android:name': 'android.appwidget.provider',
            'android:resource': `@xml/widget_${widget.key}_info`,
          },
        },
      ],
    };
    // Idempotent: prebuild may run this more than once, and an existing entry
    // is replaced so its label is current.
    const at = application.receiver.findIndex((r) => r?.$?.['android:name'] === name);
    if (at >= 0) application.receiver[at] = receiver;
    else application.receiver.push(receiver);
  }
  return androidManifest;
}

/**
 * Register the transparent voice-capture trampoline as an internal Activity: not
 * exported (only the app's own widgets launch it), kept off the recents list,
 * and on its own empty task affinity so it never merges into the app's task.
 */
function addVoiceActivity(androidManifest) {
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  application.activity = application.activity ?? [];
  const name = '.widget.VoiceCaptureActivity';
  if (application.activity.some((a) => a?.$?.['android:name'] === name)) return androidManifest;
  application.activity.push({
    $: {
      'android:name': name,
      'android:theme': '@android:style/Theme.Translucent.NoTitleBar',
      'android:exported': 'false',
      'android:excludeFromRecents': 'true',
      'android:taskAffinity': '',
      'android:configChanges': 'orientation|screenSize|keyboardHidden',
    },
  });
  return androidManifest;
}

// --- file writing -------------------------------------------------------------

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function writeNativeSources(projectRoot, pkg) {
  const main = path.join(projectRoot, 'android', 'app', 'src', 'main');
  const res = path.join(main, 'res');
  const kotlinDir = path.join(main, 'java', ...pkg.split('.'), 'widget');

  // What older versions wrote and this one no longer does.
  for (const w of RETIRED) {
    fs.rmSync(path.join(res, 'xml', `widget_${w.key}_info.xml`), { force: true });
    fs.rmSync(path.join(res, 'layout', `widget_${w.key}.xml`), { force: true });
    fs.rmSync(path.join(kotlinDir, `${w.className}.kt`), { force: true });
  }
  for (const name of RETIRED_DRAWABLES) {
    fs.rmSync(path.join(res, 'drawable', `${name}.xml`), { force: true });
  }

  for (const [name, body] of Object.entries(DRAWABLES)) {
    writeFile(path.join(res, 'drawable', `${name}.xml`), body);
  }
  writeFile(path.join(res, 'values', 'waves_widget_colors.xml'), COLORS_LIGHT);
  writeFile(path.join(res, 'values-night', 'waves_widget_colors.xml'), COLORS_DARK);
  writeFile(path.join(res, 'values', 'waves_widget_strings.xml'), STRINGS_XML);

  for (const widget of WIDGETS) {
    writeFile(path.join(res, 'xml', `widget_${widget.key}_info.xml`), infoXml(widget));
    writeFile(path.join(res, 'layout', `widget_${widget.key}.xml`), LAYOUTS[widget.key]());
    writeFile(path.join(kotlinDir, `${widget.className}.kt`), kotlinProvider(widget, pkg));
  }
  writeFile(path.join(kotlinDir, 'VoiceCaptureActivity.kt'), trampolineActivity(pkg));
}

// --- plugin -------------------------------------------------------------------

module.exports = function withWavesWidgets(config) {
  config = withAndroidManifest(config, (cfg) => {
    cfg.modResults = addReceivers(cfg.modResults);
    cfg.modResults = addVoiceActivity(cfg.modResults);
    return cfg;
  });

  config = withDangerousMod(config, [
    'android',
    (cfg) => {
      const pkg = cfg.android?.package;
      if (!pkg) throw new Error('withWavesWidgets: android.package is not set');
      writeNativeSources(cfg.modRequest.projectRoot, pkg);
      return cfg;
    },
  ]);

  return config;
};

// Exposed for the plugin's unit test (test/widgetsPlugin.test.ts). Not part of
// the plugin's runtime contract.
module.exports._internals = {
  WIDGETS,
  SEARCH,
  LINKS,
  VOICE,
  RETIRED,
  STRINGS,
  DRAWABLES,
  COLORS_LIGHT,
  COLORS_DARK,
  tapsOf,
  infoXml,
  searchLayoutXml,
  kotlinProvider,
  trampolineActivity,
  addReceivers,
  addVoiceActivity,
  writeNativeSources,
};
