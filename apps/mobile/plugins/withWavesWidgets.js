/**
 * Home-screen launcher widgets for Android.
 *
 * Three 1×1 widgets (plus a 4×2 "Waves" home widget, see HOME_WIDGET) — quick-add an expense, scan a receipt, and voice — each a
 * single tap that fires the deep link the app already resolves (`/capture`,
 * `/capture?scan=…`, `/voice`, routed through `+native-intent.ts`). They hold
 * no data and run no timeline; they are pure shortcuts, the home-screen sibling
 * of the app-icon quick actions the app already ships.
 *
 * Why a config plugin rather than checked-in native files: `android/` is
 * generated and gitignored (CNG / prebuild), so anything dropped there by hand
 * is erased on the next `expo prebuild`. Every widget source — the manifest
 * receivers, the `res/` xml/layout/drawable, and the Kotlin providers — is
 * therefore emitted here so prebuild reproduces it. Modelled structurally on
 * `withShortNativeBuildPath.js`, the repo's other local plugin.
 *
 * The iOS half of this feature lives in `targets/widgets` (@bacons/apple-targets).
 */

const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('expo/config-plugins');

/** The three widgets. `scheme` matches the primary app scheme in app.json. */
const SCHEME = 'waves';
const WIDGETS = [
  {
    className: 'QuickExpenseWidget',
    key: 'quick',
    label: 'Add expense',
    link: `${SCHEME}:///capture`,
    icon: 'ic_widget_add',
    // Distinct request code so the three PendingIntents never collide.
    requestCode: 1,
  },
  {
    className: 'ScanReceiptWidget',
    key: 'scan',
    label: 'Scan receipt',
    // A fixed marker, not the real nonce: a widget link is baked at build time
    // and can't vary per tap. +native-intent.ts rewrites `?scan=<anything>` to a
    // fresh `Date.now()` on the way in, so every tap re-fires the scanner rather
    // than being swallowed by the capture screen's consume-once guard.
    link: `${SCHEME}:///capture?scan=1`,
    icon: 'ic_widget_scan',
    requestCode: 2,
  },
  {
    className: 'VoiceWidget',
    key: 'voice',
    label: 'Voice',
    link: `${SCHEME}:///voice`,
    icon: 'ic_widget_voice',
    requestCode: 3,
    // The voice widget does not open the app first. Its tap launches a
    // transparent trampoline that fires the system speech recogniser over the
    // home screen (no cold start, no splash), then deep-links the transcript in.
    trampoline: true,
  },
];

const ACCENT = '#7A5AF8';

/**
 * The 4x2 "Waves" home widget: an Add-expense pill (camera + voice on its right)
 * over a row of three tiles (Mic, Photo, Add expense). Unlike the 1x1 shortcuts above it is a
 * different size class, so it sits beside them rather than replacing them.
 * Every target is a deep link already routed by expo-router (`src/app/*`).
 */
const HOME_WIDGET = {
  className: 'WavesHomeWidget',
  key: 'home',
  label: 'Waves',
  description: 'Add expenses from your home screen',
  pill: { id: 'widget_pill', link: `${SCHEME}:///capture`, label: 'Add expense', requestCode: 10 },
  camera: {
    id: 'widget_camera',
    link: `${SCHEME}:///capture?scan=1`,
    label: 'Scan receipt',
    requestCode: 11,
  },
  // Voice goes through the same trampoline as the 1x1 voice widget.
  voice: { id: 'widget_voice', label: 'Voice', requestCode: 12 },
  // Three equal tiles. Mic shares the pill's voice trampoline; Photo opens the
  // photo library on the capture screen (`?gallery=1`, nonce-rewritten by
  // +native-intent.ts like `?scan=1`); Add expense matches the pill.
  tiles: [
    {
      id: 'widget_tile_mic',
      label: 'Mic',
      icon: 'ic_widget_mic',
      trampoline: true,
      requestCode: 13,
    },
    {
      id: 'widget_tile_photo',
      label: 'Photo',
      icon: 'ic_widget_photo',
      link: `${SCHEME}:///capture?gallery=1`,
      requestCode: 14,
    },
    {
      id: 'widget_tile_add',
      label: 'Add expense',
      icon: 'ic_widget_plus',
      link: `${SCHEME}:///capture`,
      requestCode: 15,
    },
  ],
};

const ALL_WIDGETS = [...WIDGETS, HOME_WIDGET];

// Light / dark surfaces. Android resolves values-night per the system theme when
// the RemoteViews inflate, so the widget follows dark mode with no code.
const COLORS_LIGHT = `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="waves_widget_container">#F4F4F5</color>
  <color name="waves_widget_tile">#FFFFFF</color>
  <color name="waves_widget_pill">#FFFFFF</color>
  <color name="waves_widget_fg">#1F1F1F</color>
  <color name="waves_widget_accent">${ACCENT}</color>
</resources>
`;
const COLORS_DARK = `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="waves_widget_container">#1F1F1F</color>
  <color name="waves_widget_tile">#2B2B2B</color>
  <color name="waves_widget_pill">#2B2B2B</color>
  <color name="waves_widget_fg">#FFFFFF</color>
  <color name="waves_widget_accent">#9B82FF</color>
</resources>
`;
const STRINGS_XML = `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="waves_widget_home_description">${HOME_WIDGET.description}</string>
</resources>
`;

const roundedRect = (color, radius) => `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
  <solid android:color="${color}" />
  <corners android:radius="${radius}dp" />
</shape>
`;

const vec = (pathData) => `<vector xmlns:android="http://schemas.android.com/apk/res/android"
  android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
  <path android:fillColor="@color/waves_widget_fg" android:pathData="${pathData}" />
</vector>
`;

const HOME_DRAWABLES = {
  widget_home_container: roundedRect('@color/waves_widget_container', 28),
  widget_home_pill: roundedRect('@color/waves_widget_pill', 22),
  widget_home_tile: roundedRect('@color/waves_widget_tile', 16),
  // The Waves mark (assets/brand/wave-mark.json): a zig-zag stroke plus a dot.
  ic_widget_mark: `<vector xmlns:android="http://schemas.android.com/apk/res/android"
  android:width="32dp" android:height="32dp" android:viewportWidth="72" android:viewportHeight="72">
  <path android:strokeColor="@color/waves_widget_accent" android:strokeWidth="6"
    android:strokeLineCap="round" android:strokeLineJoin="round"
    android:pathData="M10,24L17,56L25,42L36,22L47,42L55,56L62,24" />
  <path android:fillColor="@color/waves_widget_accent"
    android:pathData="M62,13a4,4 0,1 0,0.01 0z" />
</vector>
`,
  ic_widget_camera: vec(
    'M9,3L7.17,5H4a2,2 0,0 0,-2 2v12a2,2 0,0 0,2 2h16a2,2 0,0 0,2 -2V7a2,2 0,0 0,-2 -2h-3.17L15,3H9zM12,17.5a4.5,4.5 0,1 1,0 -9 4.5,4.5 0,0 1,0 9zM12,15.5a2.5,2.5 0,1 0,0 -5 2.5,2.5 0,0 0,0 5z',
  ),
  ic_widget_waveform: vec('M11,3h2v18h-2zM7,8h2v8H7zM15,7h2v10h-2zM3,11h2v2H3zM19,10h2v4h-2z'),
  ic_widget_mic: vec(
    'M12,3a3,3 0,0 1,3 3v6a3,3 0,0 1,-6 0V6a3,3 0,0 1,3 -3zM5,11h2a5,5 0,0 0,10 0h2a7,7 0,0 1,-6 6.92V21h-2v-3.08A7,7 0,0 1,5 11z',
  ),
  ic_widget_photo: vec(
    'M21,19V5a2,2 0,0 0,-2 -2H5a2,2 0,0 0,-2 2v14a2,2 0,0 0,2 2h14a2,2 0,0 0,2 -2zM8.5,13.5l2.5,3.01L14.5,12l4.5,6H5l3.5,-4.5z',
  ),
  ic_widget_plus: vec('M11,5h2v6h6v2h-6v6h-2v-6H5v-2h6z'),
};

const homeInfoXml = `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
  android:minWidth="250dp"
  android:minHeight="110dp"
  android:minResizeWidth="180dp"
  android:minResizeHeight="100dp"
  android:targetCellWidth="4"
  android:targetCellHeight="2"
  android:resizeMode="horizontal|vertical"
  android:widgetCategory="home_screen"
  android:description="@string/waves_widget_home_description"
  android:previewImage="@drawable/ic_widget_mark"
  android:previewLayout="@layout/widget_home"
  android:initialLayout="@layout/widget_home" />
`;

const homeLayoutXml = () => {
  const tile = (t) => `    <LinearLayout
      android:id="@+id/${t.id}"
      android:layout_width="0dp"
      android:layout_height="match_parent"
      android:layout_weight="1"
      android:layout_marginStart="3dp"
      android:layout_marginEnd="3dp"
      android:orientation="vertical"
      android:gravity="center"
      android:background="@drawable/widget_home_tile"
      android:contentDescription="${t.label}">
      <ImageView
        android:layout_width="24dp"
        android:layout_height="24dp"
        android:src="@drawable/${t.icon}" />
      <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_marginTop="6dp"
        android:text="${t.label}"
        android:textColor="@color/waves_widget_fg"
        android:textSize="12sp"
        android:maxLines="1"
        android:ellipsize="end" />
    </LinearLayout>`;
  return `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
  android:id="@+id/widget_root"
  android:layout_width="match_parent"
  android:layout_height="match_parent"
  android:orientation="vertical"
  android:padding="8dp"
  android:background="@drawable/widget_home_container">
  <LinearLayout
    android:id="@+id/${HOME_WIDGET.pill.id}"
    android:layout_width="match_parent"
    android:layout_height="0dp"
    android:layout_weight="1"
    android:orientation="horizontal"
    android:gravity="center_vertical"
    android:paddingStart="14dp"
    android:paddingEnd="6dp"
    android:background="@drawable/widget_home_pill"
    android:contentDescription="${HOME_WIDGET.pill.label}">
    <ImageView
      android:layout_width="26dp"
      android:layout_height="26dp"
      android:src="@drawable/ic_widget_mark" />
    <TextView
      android:layout_width="0dp"
      android:layout_height="wrap_content"
      android:layout_weight="1"
      android:layout_marginStart="10dp"
      android:text="${HOME_WIDGET.pill.label}"
      android:textColor="@color/waves_widget_fg"
      android:textSize="17sp"
      android:textStyle="bold"
      android:maxLines="1"
      android:ellipsize="end" />
    <ImageView
      android:id="@+id/${HOME_WIDGET.camera.id}"
      android:layout_width="44dp"
      android:layout_height="match_parent"
      android:padding="10dp"
      android:src="@drawable/ic_widget_camera"
      android:contentDescription="${HOME_WIDGET.camera.label}" />
    <ImageView
      android:id="@+id/${HOME_WIDGET.voice.id}"
      android:layout_width="44dp"
      android:layout_height="match_parent"
      android:padding="10dp"
      android:src="@drawable/ic_widget_waveform"
      android:contentDescription="${HOME_WIDGET.voice.label}" />
  </LinearLayout>
  <LinearLayout
    android:layout_width="match_parent"
    android:layout_height="0dp"
    android:layout_weight="1.6"
    android:layout_marginTop="6dp"
    android:orientation="horizontal">
${HOME_WIDGET.tiles.map(tile).join('\n')}
  </LinearLayout>
</LinearLayout>
`;
};

const homeKotlinProvider = (pkg) => {
  const deepLink = (id, link, code) => `    views.setOnClickPendingIntent(
      R.id.${id},
      PendingIntent.getActivity(context, ${code}, deepLink("${link}"), FLAGS),
    )`;
  const w = HOME_WIDGET;
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
 * ${w.label} — the 4x2 home widget: an Add-expense pill (camera, voice) over three
 * navigation tiles. Colours come from res/values and res/values-night, so it
 * follows the system theme. Generated by plugins/withWavesWidgets.js.
 */
class ${w.className} : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) {
      val views = RemoteViews(context.packageName, R.layout.widget_${w.key})
      bind(context, views)
      manager.updateAppWidget(id, views)
    }
  }

  private fun bind(context: Context, views: RemoteViews) {
    fun deepLink(url: String) =
      Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
        setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      }
${deepLink(w.pill.id, w.pill.link, w.pill.requestCode)}
${deepLink(w.camera.id, w.camera.link, w.camera.requestCode)}
    val voice = Intent(context, VoiceCaptureActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    views.setOnClickPendingIntent(
      R.id.${w.voice.id},
      PendingIntent.getActivity(context, ${w.voice.requestCode}, voice, FLAGS),
    )
${w.tiles
  .map((t) =>
    t.trampoline
      ? `    views.setOnClickPendingIntent(
      R.id.${t.id},
      PendingIntent.getActivity(context, ${t.requestCode}, voice, FLAGS),
    )`
      : deepLink(t.id, t.link, t.requestCode),
  )
  .join('\n')}
  }

  companion object {
    private const val FLAGS = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
  }
}
`;
};

// --- res/ file bodies ---------------------------------------------------------

const BACKGROUND_DRAWABLE = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
  <solid android:color="${ACCENT}" />
  <corners android:radius="24dp" />
</shape>
`;

const ICONS = {
  ic_widget_add: `<vector xmlns:android="http://schemas.android.com/apk/res/android"
  android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
  <path android:fillColor="#FFFFFF" android:pathData="M11,5h2v6h6v2h-6v6h-2v-6H5v-2h6z" />
</vector>
`,
  ic_widget_scan: `<vector xmlns:android="http://schemas.android.com/apk/res/android"
  android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
  <path android:fillColor="#FFFFFF" android:pathData="M4,4h4v2H6v2H4zM16,4h4v4h-2V6h-2zM4,16h2v2h2v2H4zM18,16h2v4h-4v-2h2zM7,11h10v2H7z" />
</vector>
`,
  ic_widget_voice: `<vector xmlns:android="http://schemas.android.com/apk/res/android"
  android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
  <path android:fillColor="#FFFFFF" android:pathData="M12,3a3,3 0,0 1,3 3v6a3,3 0,0 1,-6 0V6a3,3 0,0 1,3 -3zM5,11h2a5,5 0,0 0,10 0h2a7,7 0,0 1,-6 6.92V21h-2v-3.08A7,7 0,0 1,5 11z" />
</vector>
`,
};

const widgetInfoXml = (widget) => `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
  android:minWidth="40dp"
  android:minHeight="40dp"
  android:targetCellWidth="1"
  android:targetCellHeight="1"
  android:resizeMode="none"
  android:widgetCategory="home_screen"
  android:previewImage="@drawable/${widget.icon}"
  android:initialLayout="@layout/widget_${widget.key}" />
`;

const widgetLayoutXml = (widget) => `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
  android:id="@+id/widget_root"
  android:layout_width="match_parent"
  android:layout_height="match_parent"
  android:orientation="vertical"
  android:gravity="center"
  android:padding="8dp"
  android:background="@drawable/widget_background">
  <ImageView
    android:layout_width="28dp"
    android:layout_height="28dp"
    android:src="@drawable/${widget.icon}"
    android:contentDescription="${widget.label}" />
  <TextView
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:layout_marginTop="4dp"
    android:text="${widget.label}"
    android:textColor="#FFFFFF"
    android:textSize="11sp"
    android:maxLines="1"
    android:ellipsize="end" />
</LinearLayout>
`;

const kotlinProvider = (widget, pkg) => {
  // A trampoline widget targets its own capture Activity (which then deep-links
  // the app); an ordinary one fires the ACTION_VIEW deep link straight away.
  const imports = widget.trampoline
    ? `import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import ${pkg}.R`
    : `import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import ${pkg}.R`;
  const intentBlock = widget.trampoline
    ? `val intent = Intent(context, VoiceCaptureActivity::class.java).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }`
    : `val intent = Intent(Intent.ACTION_VIEW, Uri.parse("${widget.link}")).apply {
        setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      }`;
  const opens = widget.trampoline
    ? `records straight from the home screen (see VoiceCaptureActivity)`
    : `opens ${widget.link}`;
  return `package ${pkg}.widget

${imports}

/**
 * ${widget.label} — a launcher widget that ${opens}.
 * Generated by plugins/withWavesWidgets.js; do not edit under android/.
 */
class ${widget.className} : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) {
      val views = RemoteViews(context.packageName, R.layout.widget_${widget.key})
      ${intentBlock}
      val pending = PendingIntent.getActivity(
        context,
        ${widget.requestCode},
        intent,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
      views.setOnClickPendingIntent(R.id.widget_root, pending)
      manager.updateAppWidget(id, views)
    }
  }
}
`;
};

/**
 * The transparent trampoline the voice widget launches: it fires the platform
 * speech recogniser (offline-preferred, so the on-device model is used where the
 * network one is unreliable) over the home screen, then hands the transcript to
 * the app on `${SCHEME}:///voice?heard=…`. A per-tap `hn` nonce lets a warm voice
 * screen re-read a fresh capture. No speech service (or a cancel) falls back to
 * opening the in-app mic.
 */
const trampolineActivity = (pkg) => `package ${pkg}.widget

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.speech.RecognizerIntent

/**
 * Instant voice capture for the ${SCHEME} voice widget.
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
  application.receiver = application.receiver ?? [];

  for (const widget of ALL_WIDGETS) {
    const name = `.widget.${widget.className}`;
    // Idempotent: prebuild may run this more than once.
    const exists = application.receiver.some((r) => r?.$?.['android:name'] === name);
    if (exists) continue;

    application.receiver.push({
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
    });
  }
  return androidManifest;
}

/**
 * Register the transparent voice-capture trampoline as an internal Activity: not
 * exported (only the app's own widget launches it), kept off the recents list,
 * and on its own empty task affinity so it never merges into the app's task.
 */
function addVoiceActivity(androidManifest) {
  if (!WIDGETS.some((w) => w.trampoline)) return androidManifest;
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

  writeFile(path.join(res, 'drawable', 'widget_background.xml'), BACKGROUND_DRAWABLE);
  for (const [name, body] of Object.entries(ICONS)) {
    writeFile(path.join(res, 'drawable', `${name}.xml`), body);
  }

  const kotlinDir = path.join(main, 'java', ...pkg.split('.'), 'widget');
  for (const widget of WIDGETS) {
    writeFile(path.join(res, 'xml', `widget_${widget.key}_info.xml`), widgetInfoXml(widget));
    writeFile(path.join(res, 'layout', `widget_${widget.key}.xml`), widgetLayoutXml(widget));
    writeFile(path.join(kotlinDir, `${widget.className}.kt`), kotlinProvider(widget, pkg));
  }
  // The 4x2 home widget.
  for (const [name, body] of Object.entries(HOME_DRAWABLES)) {
    writeFile(path.join(res, 'drawable', `${name}.xml`), body);
  }
  writeFile(path.join(res, 'values', 'waves_widget_colors.xml'), COLORS_LIGHT);
  writeFile(path.join(res, 'values-night', 'waves_widget_colors.xml'), COLORS_DARK);
  writeFile(path.join(res, 'values', 'waves_widget_strings.xml'), STRINGS_XML);
  writeFile(path.join(res, 'xml', `widget_${HOME_WIDGET.key}_info.xml`), homeInfoXml);
  writeFile(path.join(res, 'layout', `widget_${HOME_WIDGET.key}.xml`), homeLayoutXml());
  writeFile(path.join(kotlinDir, `${HOME_WIDGET.className}.kt`), homeKotlinProvider(pkg));
  // The trampoline Activity, emitted once when any widget uses it.
  if (WIDGETS.some((w) => w.trampoline)) {
    writeFile(path.join(kotlinDir, 'VoiceCaptureActivity.kt'), trampolineActivity(pkg));
  }
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

// Exposed for the plugin's unit test (test/withWavesWidgets.test.ts). Not part
// of the plugin's runtime contract.
module.exports._internals = {
  WIDGETS,
  HOME_WIDGET,
  HOME_DRAWABLES,
  homeLayoutXml,
  homeKotlinProvider,
  COLORS_LIGHT,
  COLORS_DARK,
  addReceivers,
  addVoiceActivity,
  writeNativeSources,
  widgetInfoXml,
  widgetLayoutXml,
  kotlinProvider,
  trampolineActivity,
  ICONS,
  BACKGROUND_DRAWABLE,
};
