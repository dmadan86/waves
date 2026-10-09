import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// The config plugin is plain JS; pull out the internals it exposes for testing.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { _internals } = require('../plugins/withWavesWidgets.js');

type Tap = { id: string; target: string; requestCode: number };
type Widget = {
  className: string;
  key: string;
  label: string;
  description: string;
  info: { cellsW: number; cellsH: number };
};

const { WIDGETS, COMPACT, SEARCH, GRID, LINKS, VOICE, RETIRED, STRINGS, tapsOf } = _internals as {
  WIDGETS: Widget[];
  COMPACT: Widget & { buttons: Tap[] };
  SEARCH: Widget & {
    pill: Tap;
    mic: Tap;
    more: Tap;
    chips: (Tap & { category: string })[];
  };
  GRID: Widget & { settings: Tap; tiles: (Tap & { title: string })[] };
  LINKS: Record<string, string>;
  VOICE: string;
  RETIRED: { className: string; key: string }[];
  STRINGS: Record<string, string>;
  tapsOf: (w: Widget) => Tap[];
};
const { addReceivers, addVoiceActivity, writeNativeSources } = _internals as {
  addReceivers: (m: unknown) => { manifest: { application: { receiver?: unknown[] }[] } };
  addVoiceActivity: (m: unknown) => { manifest: { application: { activity?: unknown[] }[] } };
  writeNativeSources: (projectRoot: string, pkg: string) => void;
};

const PKG = 'app.waves.mobile';

type Receiver = {
  $: Record<string, string>;
  'intent-filter': { action: { $: Record<string, string> }[] }[];
  'meta-data': { $: Record<string, string> }[];
};

/** A minimal parsed AndroidManifest, the shape expo's manifest mods pass around. */
function emptyManifest(receiver: unknown[] = []) {
  return {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android', package: PKG },
      application: [{ $: { 'android:name': '.MainApplication' }, receiver }],
    },
  };
}

describe('withWavesWidgets — the three widgets', () => {
  it('ships exactly the compact, search and action-grid widgets', () => {
    expect(WIDGETS.map((w) => w.key)).toEqual(['compact', 'search', 'home']);
    expect(WIDGETS.map((w) => [w.info.cellsW, w.info.cellsH])).toEqual([
      [4, 1],
      [4, 2],
      [4, 2],
    ]);
  });

  it('compact: photo, voice and manual, with the card opening quick add', () => {
    expect(COMPACT.buttons.map((b) => b.target)).toEqual([LINKS.photo, VOICE, LINKS.manual]);
    expect(tapsOf(COMPACT)[0]).toMatchObject({ id: 'widget_root', target: 'waves:///capture' });
  });

  it('search: the pill opens quick add, the mic opens voice, chips preset a category', () => {
    expect(SEARCH.pill.target).toBe('waves:///capture');
    expect(SEARCH.mic.target).toBe(VOICE);
    expect(SEARCH.chips.map((c) => c.category)).toEqual(['food', 'travel', 'shopping']);
    const chipTargets = tapsOf(SEARCH)
      .filter((t) => t.id.startsWith('widget_chip_') && t.id !== SEARCH.more.id)
      .map((t) => t.target);
    expect(chipTargets).toEqual([
      'waves:///capture?category=food',
      'waves:///capture?category=travel',
      'waves:///capture?category=shopping',
    ]);
    expect(SEARCH.more.target).toBe('waves:///capture');
  });

  it('grid: Photo, Voice, Scan and Manual, and a gear that opens settings', () => {
    expect(GRID.tiles.map((t) => [t.title, t.target])).toEqual([
      ['waves_widget_photo', 'waves:///capture?gallery=1'],
      ['waves_widget_voice', VOICE],
      ['waves_widget_scan', 'waves:///capture?scan=1'],
      ['waves_widget_manual', 'waves:///capture'],
    ]);
    expect(GRID.settings.target).toBe('waves:///profile');
  });

  it('keeps the old 4x2 home widget name, so a placed one redraws instead of breaking', () => {
    expect(GRID.className).toBe('WavesHomeWidget');
    expect(GRID.key).toBe('home');
  });

  it('never reuses a PendingIntent request code', () => {
    const codes = WIDGETS.flatMap((w) => tapsOf(w).map((t) => t.requestCode));
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('withWavesWidgets — manifest', () => {
  it('adds one exported receiver per widget, each wired to its provider xml', () => {
    const out = addReceivers(emptyManifest());
    const receivers = out.manifest.application[0].receiver as Receiver[];
    expect(receivers).toHaveLength(3);

    for (const widget of WIDGETS) {
      const receiver = receivers.find((r) => r.$['android:name'] === `.widget.${widget.className}`);
      expect(receiver, `receiver for ${widget.className}`).toBeTruthy();
      expect(receiver!.$['android:exported']).toBe('true');
      expect(receiver!.$['android:label']).toMatch(/^@string\/waves_widget_/);
      expect(receiver!['intent-filter'][0].action[0].$['android:name']).toBe(
        'android.appwidget.action.APPWIDGET_UPDATE',
      );
      expect(receiver!['meta-data'][0].$['android:resource']).toBe(
        `@xml/widget_${widget.key}_info`,
      );
    }
  });

  it('is idempotent — a second prebuild does not duplicate receivers', () => {
    const manifest = emptyManifest();
    addReceivers(manifest);
    const out = addReceivers(manifest);
    expect(out.manifest.application[0].receiver).toHaveLength(3);
  });

  it('drops the retired 1x1 receivers a non-clean prebuild would otherwise keep', () => {
    const stale = RETIRED.map((w) => ({ $: { 'android:name': `.widget.${w.className}` } }));
    const other = { $: { 'android:name': '.SomethingElse' } };
    const out = addReceivers(emptyManifest([...stale, other]));
    const names = (out.manifest.application[0].receiver as Receiver[]).map(
      (r) => r.$['android:name'],
    );
    for (const w of RETIRED) expect(names).not.toContain(`.widget.${w.className}`);
    expect(names).toContain('.SomethingElse');
  });

  it('registers the voice trampoline once, unexported', () => {
    const manifest = emptyManifest();
    addVoiceActivity(manifest);
    const out = addVoiceActivity(manifest);
    const activities = out.manifest.application[0].activity as { $: Record<string, string> }[];
    expect(activities).toHaveLength(1);
    expect(activities[0].$['android:name']).toBe('.widget.VoiceCaptureActivity');
    expect(activities[0].$['android:exported']).toBe('false');
  });
});

describe('withWavesWidgets — emitted native sources', () => {
  const root = mkdtempSync(join(tmpdir(), 'waves-widgets-'));
  const main = join(root, 'android', 'app', 'src', 'main');
  const kotlinDir = join(main, 'java', ...PKG.split('.'), 'widget');
  // A stale 1x1 widget from an older prebuild, which this one must clear away.
  mkdirSync(join(main, 'res', 'layout'), { recursive: true });
  writeFileSync(join(main, 'res', 'layout', 'widget_quick.xml'), '<LinearLayout />');
  mkdirSync(kotlinDir, { recursive: true });
  writeFileSync(join(kotlinDir, 'QuickExpenseWidget.kt'), '// stale');
  writeNativeSources(root, PKG);
  const read = (p: string) => readFileSync(join(main, p), 'utf8');

  it('writes a provider-info, layout, and Kotlin provider per widget', () => {
    for (const widget of WIDGETS) {
      expect(existsSync(join(main, 'res', 'xml', `widget_${widget.key}_info.xml`))).toBe(true);
      expect(existsSync(join(main, 'res', 'layout', `widget_${widget.key}.xml`))).toBe(true);
      expect(existsSync(join(kotlinDir, `${widget.className}.kt`))).toBe(true);
    }
  });

  it('removes the retired widgets left behind by an older prebuild', () => {
    expect(existsSync(join(main, 'res', 'layout', 'widget_quick.xml'))).toBe(false);
    expect(existsSync(join(kotlinDir, 'QuickExpenseWidget.kt'))).toBe(false);
  });

  it('each provider info sizes its cells, previews its own layout, and describes itself', () => {
    for (const widget of WIDGETS) {
      const info = read(join('res', 'xml', `widget_${widget.key}_info.xml`));
      expect(info).toContain(`android:targetCellWidth="${widget.info.cellsW}"`);
      expect(info).toContain(`android:targetCellHeight="${widget.info.cellsH}"`);
      expect(info).toContain(`android:previewLayout="@layout/widget_${widget.key}"`);
      expect(info).toContain(`android:initialLayout="@layout/widget_${widget.key}"`);
      expect(info).toContain(`android:description="${widget.description}"`);
      expect(info).toContain('android:minWidth=');
      expect(info).toContain('android:minHeight=');
      expect(info).toContain('home_screen');
    }
  });

  it('every layout uses only RemoteViews-safe views and the glass card with the W logo', () => {
    const allowed = new Set(['LinearLayout', 'FrameLayout', 'ImageView', 'TextView']);
    for (const widget of WIDGETS) {
      const layout = read(join('res', 'layout', `widget_${widget.key}.xml`));
      const tags = [...layout.matchAll(/<([A-Za-z.]+)[\s>]/g)].map((m) => m[1]);
      for (const tag of tags) expect(allowed, `${widget.key}: <${tag}>`).toContain(tag);
      expect(layout).toContain('@+id/widget_root');
      expect(layout).toContain('@drawable/widget_card');
      expect(layout).toContain('@drawable/ic_widget_logo');
    }
  });

  it('every tap target exists in its layout and is wired in its provider', () => {
    for (const widget of WIDGETS) {
      const layout = read(join('res', 'layout', `widget_${widget.key}.xml`));
      const kotlin = readFileSync(join(kotlinDir, `${widget.className}.kt`), 'utf8');
      expect(kotlin).toContain(`package ${PKG}.widget`);
      expect(kotlin).toContain(`R.layout.widget_${widget.key}`);
      expect(kotlin).toContain('FLAG_IMMUTABLE');
      for (const tap of tapsOf(widget)) {
        expect(layout).toContain(`@+id/${tap.id}`);
        expect(kotlin).toContain(`R.id.${tap.id}`);
        if (tap.target === VOICE) expect(kotlin).toContain('VoiceCaptureActivity::class.java');
        else expect(kotlin).toContain(`deepLink(context, "${tap.target}")`);
      }
    }
  });

  it('every @string a layout or provider info names is defined', () => {
    const strings = read(join('res', 'values', 'waves_widget_strings.xml'));
    for (const name of Object.keys(STRINGS)) expect(strings).toContain(`name="${name}"`);
    for (const widget of WIDGETS) {
      const files = [
        read(join('res', 'layout', `widget_${widget.key}.xml`)),
        read(join('res', 'xml', `widget_${widget.key}_info.xml`)),
        widget.label,
      ];
      for (const file of files) {
        for (const [, name] of file.matchAll(/@string\/(\w+)/g)) {
          expect(STRINGS, `@string/${name}`).toHaveProperty(name);
        }
      }
    }
    expect(strings).toContain('What did you spend on?');
    expect(strings).toContain('Capture expenses, anywhere');
  });

  it('every @drawable and @color it names is emitted, in light and dark', () => {
    const light = read(join('res', 'values', 'waves_widget_colors.xml'));
    const dark = read(join('res', 'values-night', 'waves_widget_colors.xml'));
    expect(light).toContain('#6C4EE3');
    for (const widget of WIDGETS) {
      const layout = read(join('res', 'layout', `widget_${widget.key}.xml`));
      for (const [, name] of layout.matchAll(/@drawable\/(\w+)/g)) {
        expect(existsSync(join(main, 'res', 'drawable', `${name}.xml`)), name).toBe(true);
      }
      for (const [, name] of layout.matchAll(/@color\/(\w+)/g)) {
        expect(light).toContain(`name="${name}"`);
        expect(dark).toContain(`name="${name}"`);
      }
    }
  });

  it('the voice trampoline recognises speech and deep-links it back', () => {
    const kotlin = readFileSync(join(kotlinDir, 'VoiceCaptureActivity.kt'), 'utf8');
    expect(kotlin).toContain('RecognizerIntent.ACTION_RECOGNIZE_SPEECH');
    expect(kotlin).toContain('EXTRA_PREFER_OFFLINE');
    expect(kotlin).toContain('waves:///voice');
    expect(kotlin).toContain('appendQueryParameter("heard"');
  });
});
