/**
 * The two halves of the launch are the same colour, or the seam shows.
 *
 * The launch paints twice: `expo-splash-screen` shows a flat field from
 * `app.json` while the JS loads, then `AnimatedSplash` mounts and paints its
 * own field over it. They are meant to be indistinguishable — the handoff is
 * a flat colour meeting the same flat colour, which is the one transition that
 * cannot be seen. Change one and not the other and every cold start flashes.
 *
 * Both files say in prose that they move together. This makes it true.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

const appJson = JSON.parse(readFileSync(join(__dirname, '..', 'app.json'), 'utf8')) as {
  expo: { plugins: (string | [string, Record<string, unknown>])[] };
};

const splashPlugin = appJson.expo.plugins.find(
  (entry): entry is [string, Record<string, unknown>] =>
    Array.isArray(entry) && entry[0] === 'expo-splash-screen',
);

const componentSource = readFileSync(
  join(__dirname, '..', 'src', 'components', 'AnimatedSplash.tsx'),
  'utf8',
);

const markSource = readFileSync(join(__dirname, '..', 'src', 'components', 'WaveMark.tsx'), 'utf8');

/** A `const NAME = '#RRGGBB';` declaration, read out of the source. */
function colourOf(source: string, name: string): string | null {
  return new RegExp(`const ${name} = '(#[0-9A-Fa-f]{6})'`).exec(source)?.[1] ?? null;
}

describe('the launch field', () => {
  it('is configured in app.json', () => {
    expect(splashPlugin).toBeDefined();
    expect(splashPlugin?.[1].backgroundColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('is the same colour in both halves of the launch', () => {
    expect(colourOf(componentSource, 'SPLASH_BG')).toBe(splashPlugin?.[1].backgroundColor);
  });

  it('gives expo-splash-screen an image that draws nothing', () => {
    // The native half's mark is the animated drawable written by
    // plugins/withAnimatedSplashMark.js (see splashNativeMark.test.ts), not an
    // image from this config, so the configured image must paint nothing.
    //
    // It is configured with an `image` all the same, because the plugin does
    // not treat "no image" as "no image": it deletes the splash drawables and
    // still writes `@drawable/splashscreen_logo` into the theme, which fails
    // at resource linking on a clean prebuild. A transparent image is how the
    // intent is stated in the vocabulary the tool has.
    //
    // Which makes the file itself load-bearing: the config alone cannot say
    // whether anything is drawn. So this decodes it and checks.
    const image = splashPlugin?.[1].image;
    expect(typeof image).toBe('string');

    const png = readFileSync(join(__dirname, '..', image as string));
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

    // Walk the chunks for the header and the pixel data. A 1x1 8-bit RGBA
    // image is one filter byte and four channel bytes once inflated.
    let offset = 8;
    let header: { width: number; height: number; depth: number; colour: number } | null = null;
    const pixels: Buffer[] = [];
    while (offset < png.length) {
      const length = png.readUInt32BE(offset);
      const type = png.toString('ascii', offset + 4, offset + 8);
      if (type === 'IHDR') {
        header = {
          width: png.readUInt32BE(offset + 8),
          height: png.readUInt32BE(offset + 12),
          depth: png[offset + 16],
          colour: png[offset + 17],
        };
      }
      if (type === 'IDAT') pixels.push(png.subarray(offset + 8, offset + 8 + length));
      offset += 12 + length;
    }

    // Colour type 6 is RGBA: an image with no alpha channel could not be
    // transparent whatever its pixels said.
    expect(header).toEqual({ width: 1, height: 1, depth: 8, colour: 6 });

    const raw = inflateSync(Buffer.concat(pixels));
    expect([...raw]).toEqual([0, 0, 0, 0, 0]);

    // One device pixel wide, so nothing is scaled up from that single dot.
    expect(splashPlugin?.[1].imageWidth).toBe(1);
  });

  it('draws a mark that can be seen against it', () => {
    // Not a contrast ratio — a mark is not body text — but the two must at
    // least be far apart in luminance. White on the brand purple passes wide;
    // white on the yellow this replaced would not have.
    const field = colourOf(componentSource, 'SPLASH_BG');
    const ink = colourOf(markSource, 'INK');
    expect(field).not.toBeNull();
    expect(ink).not.toBeNull();

    const luminance = (hex: string): number => {
      const channel = (from: number): number => {
        const c = parseInt(hex.slice(from, from + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
    };

    const [lighter, darker] = [luminance(field ?? ''), luminance(ink ?? '')].sort((a, b) => b - a);
    expect((lighter + 0.05) / (darker + 0.05)).toBeGreaterThan(3);
  });
});
