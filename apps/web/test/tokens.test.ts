/**
 * The web's colours are the design system's colours, and stay that way.
 *
 * `src/app/tokens.css` is generated from `packages/ui/src/themes.ts`. It is
 * committed so a build never has to run the generator — which means it can go
 * stale, and a stale copy is exactly how the drift started last time: the web
 * painted "owed to you" in a green the design system had already replaced with
 * a blue, and nothing anywhere said so.
 *
 * So: regenerate into a scratch copy and compare. If they differ, somebody
 * changed a token and did not run `pnpm --filter @waves/web tokens`.
 *
 * The second test is narrower and blunter. It asserts the one rule the system
 * states in prose — that the palette carries no green, and that money owed to
 * you is the blue — directly against the file the browser will load. A
 * regenerate-and-compare test passes happily if the source itself drifts; this
 * one does not.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const GENERATOR = fileURLToPath(new URL('../scripts/generate-tokens.mjs', import.meta.url));
const TOKENS = fileURLToPath(new URL('../src/app/tokens.css', import.meta.url));

function committed(): string {
  return readFileSync(TOKENS, 'utf8');
}

/** Every colour the stylesheet declares, as lowercase six-digit hex. */
function hexes(css: string): string[] {
  return [...css.matchAll(/#([0-9a-fA-F]{6})\b/g)].map((match) => match[1]!.toLowerCase());
}

/** Roughly "is this hue green", by channel rather than by name. */
function isGreen(hex: string): boolean {
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  // Green enough to read as green: the green channel leads both others by a
  // clear margin, and the colour is saturated enough to be a hue at all.
  return g > r + 24 && g > b + 24;
}

describe('tokens.css', () => {
  it('is what the generator would write today', () => {
    const before = committed();
    execFileSync(process.execPath, [GENERATOR], { stdio: 'pipe' });
    const after = committed();
    expect(
      after,
      'tokens.css is stale — run `pnpm --filter @waves/web tokens` and commit the result',
    ).toBe(before);
  });

  it('carries no green, because the palette is green-free', () => {
    const offenders = [...new Set(hexes(committed()).filter(isGreen))];
    expect(offenders, `these read as green: ${offenders.join(', ')}`).toEqual([]);
  });

  it('paints money owed to you blue, in both themes', () => {
    const css = committed();
    expect(css).toContain('--w-positive: #2563EB');
    expect(css).toContain('--w-positive: #60A5FA');
  });
});
