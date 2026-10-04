/**
 * The build-time half of the shortcut-icon fix.
 *
 * `android/` is generated and gitignored, so the only thing worth pinning down
 * here is that prebuild reliably reproduces the three drawables, each shaped
 * the way Android's shortcuts guide asks for a shortcut icon to be shaped: a
 * solid backdrop filling the whole 48dp canvas, with the glyph confined to the
 * inner 44dp safe zone — not the app's own two-layer adaptive-icon format.
 */

import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { _internals } = require('../plugins/withShortcutIcons.js');
const { BADGE_COLOR, GLYPHS, GLYPH_SCALE, shortcutIconXml, writeNativeSources } = _internals as {
  BADGE_COLOR: string;
  GLYPHS: Record<string, string>;
  GLYPH_SCALE: string;
  shortcutIconXml: (glyphPath: string) => string;
  writeNativeSources: (projectRoot: string) => void;
};

describe('withShortcutIcons — generated drawable', () => {
  it('fills the whole 48dp canvas with the brand purple, not a transparent or white backdrop', () => {
    const xml = shortcutIconXml(GLYPHS.ic_shortcut_add);
    expect(xml).toContain('android:width="48dp" android:height="48dp"');
    expect(xml).toContain(`android:fillColor="${BADGE_COLOR}"`);
    expect(BADGE_COLOR).toBe('#6C4EE3');
  });

  it('scales the glyph up to exactly fill the 44dp safe zone, inset by 2dp on each side', () => {
    const xml = shortcutIconXml(GLYPHS.ic_shortcut_voice);
    expect(xml).toContain('android:translateX="2" android:translateY="2"');
    expect(xml).toContain(`android:scaleX="${GLYPH_SCALE}" android:scaleY="${GLYPH_SCALE}"`);
    // 24 (the glyph's own box) * 44/24 == 44 — exactly the safe zone, no clipping.
    expect(24 * Number(GLYPH_SCALE)).toBeCloseTo(44, 1);
  });

  it('draws the glyph in white, over the purple backdrop', () => {
    const xml = shortcutIconXml(GLYPHS.ic_shortcut_scan);
    expect(xml).toContain('android:fillColor="#FFFFFF"');
    expect(xml).toContain(GLYPHS.ic_shortcut_scan);
  });

  it('has one glyph per shortcut: add, scan, voice', () => {
    expect(Object.keys(GLYPHS).sort()).toEqual([
      'ic_shortcut_add',
      'ic_shortcut_scan',
      'ic_shortcut_voice',
    ]);
  });
});

describe('withShortcutIcons — emitted native sources', () => {
  const root = mkdtempSync(join(tmpdir(), 'waves-shortcut-icons-'));
  writeNativeSources(root);
  const drawableDir = join(root, 'android', 'app', 'src', 'main', 'res', 'drawable');

  it('writes one drawable per shortcut', () => {
    for (const name of Object.keys(GLYPHS)) {
      expect(existsSync(join(drawableDir, `${name}.xml`))).toBe(true);
    }
  });

  it('each written file matches the icon it was generated for', () => {
    for (const [name, glyphPath] of Object.entries(GLYPHS)) {
      const xml = readFileSync(join(drawableDir, `${name}.xml`), 'utf8');
      expect(xml).toBe(shortcutIconXml(glyphPath));
    }
  });

  it('is idempotent — prebuild can run twice over the same tree', () => {
    writeNativeSources(root);
    for (const name of Object.keys(GLYPHS)) {
      expect(existsSync(join(drawableDir, `${name}.xml`))).toBe(true);
    }
  });
});
