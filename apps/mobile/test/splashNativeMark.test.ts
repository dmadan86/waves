/**
 * The native launch draws the mark, and hands the finished mark to the JS half.
 *
 * Android 12's splash plays an animated vector from the first frame of the
 * process; `AnimatedSplash` then starts from the finished mark. The two halves
 * only meet seamlessly if the drawable is the same mark, the same size, in the
 * same place, and ends where the JS begins. This pins each of those.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const plugin = require('../plugins/withAnimatedSplashMark.js') as {
  animatedMarkXml: () => string;
  NATIVE_DRAW_MS: number;
};
const GEOM = require('../assets/brand/wave-mark.json') as {
  canvas: number;
  points: number[][];
  strokeWidth: number;
  tiltDeg: number;
  derived: { scale: number; translate: number[]; recentre: number[] };
};

const root = join(__dirname, '..');
const appJson = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')) as {
  expo: { plugins: (string | [string, unknown])[] };
};
const splashSource = readFileSync(join(root, 'src', 'components', 'AnimatedSplash.tsx'), 'utf8');
const markSource = readFileSync(join(root, 'src', 'components', 'WaveMark.tsx'), 'utf8');

const xml = plugin.animatedMarkXml();
const attr = (name: string): string | null =>
  new RegExp(`${name}="([^"]+)"`).exec(xml)?.[1] ?? null;

describe('the native half of the launch', () => {
  it('is listed before expo-splash-screen, so its theme write runs last', () => {
    // Config mods run in reverse order of registration; expo-splash-screen
    // rewrites the splash theme, and must not have the last word.
    const names = appJson.expo.plugins.map((p) => (Array.isArray(p) ? p[0] : p));
    const ours = names.indexOf('./plugins/withAnimatedSplashMark');
    expect(ours).toBeGreaterThanOrEqual(0);
    expect(ours).toBeLessThan(names.indexOf('expo-splash-screen'));
  });

  it('has a drawable name of its own, clear of the PNGs expo-splash-screen writes', () => {
    const source = readFileSync(join(root, 'plugins', 'withAnimatedSplashMark.js'), 'utf8');
    const name = /const LOGO = '([a-z_]+)';/.exec(source)?.[1];
    expect(name).toBeTruthy();
    expect(name).not.toBe('splashscreen_logo');
  });

  it('starts undrawn, so earlier Android (which shows frame one) gets the bare field', () => {
    expect(xml).toContain('android:trimPathEnd="0"');
    expect(xml).toContain('android:fillAlpha="0"');
  });

  it('draws the same stroke WaveMark draws, from the same geometry', () => {
    // WaveMark's placement, restated: scale, translate, lean, recentre.
    const d = GEOM.derived;
    const c = GEOM.canvas;
    const t = (-GEOM.tiltDeg * Math.PI) / 180;
    const place = ([x, y]: number[]) => {
      const dx = x! * d.scale + d.translate[0]! - c / 2;
      const dy = y! * d.scale + d.translate[1]! - c / 2;
      return [
        c / 2 + dx * Math.cos(t) - dy * Math.sin(t) + d.recentre[0]!,
        c / 2 + dx * Math.sin(t) + dy * Math.cos(t) + d.recentre[1]!,
      ];
    };
    const numbers = (attr('android:pathData') ?? '').match(/-?\d+(\.\d+)?/g)!.map(Number);
    const [sx, sy] = place(GEOM.points[0]!);
    const [ex, ey] = place(GEOM.points[6]!);
    expect(numbers[0]).toBeCloseTo(sx!, 2);
    expect(numbers[1]).toBeCloseTo(sy!, 2);
    expect(numbers.at(-2)).toBeCloseTo(ex!, 2);
    expect(numbers.at(-1)).toBeCloseTo(ey!, 2);
    expect(Number(attr('android:strokeWidth'))).toBeCloseTo(GEOM.strokeWidth * d.scale, 2);
  });

  it('is the size the JS half draws, centred the same way', () => {
    const markWidth = Number(/const MARK_WIDTH = (\d+);/.exec(splashSource)?.[1]);
    expect(markWidth).toBeGreaterThan(0);
    const viewport = Number(attr('android:viewportWidth'));
    // The 512-unit canvas spans MARK_WIDTH dp inside the 288dp icon.
    expect((GEOM.canvas / viewport) * 288).toBeCloseTo(markWidth, 1);
    expect(Number(attr('android:translateX'))).toBeCloseTo((viewport - GEOM.canvas) / 2, 2);
  });

  it('is the same ink as the JS mark', () => {
    const ink = /const INK = '(#[0-9A-Fa-f]{6})'/.exec(markSource)?.[1];
    expect(xml).toContain(`android:strokeColor="${ink}"`);
    expect(xml).toContain(`android:fillColor="${ink}"`);
  });

  it('fits inside the time Android gives a splash animation', () => {
    expect(plugin.NATIVE_DRAW_MS).toBeLessThanOrEqual(1000);
  });

  it('hands over at the finished mark on Android 12+', () => {
    expect(splashSource).toMatch(/Platform\.Version >= 31/);
    expect(splashSource).toMatch(/NATIVE_DRAWS_MARK \? MARK_DRAWN : 0/);
    expect(markSource).toMatch(/export const MARK_DRAWN = DOT_END;/);
  });
});
