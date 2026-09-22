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

  it('carries no image on the native half', () => {
    // The mark draws itself on (`WaveMark`), and a logo cannot arrive if the
    // native splash has already spent a second showing it finished. So the
    // plugin gets a colour and nothing else.
    expect(splashPlugin?.[1]).not.toHaveProperty('image');
    expect(splashPlugin?.[1]).not.toHaveProperty('imageWidth');
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
