import { describe, expect, it } from 'vitest';

import { tileWidth } from '../src/lib/tileWidth';

describe('tileWidth', () => {
  it('splits a row into equal tiles with the gaps taken out', () => {
    expect(tileWidth(320, 8, 3)).toBe(304 / 3);
    expect(tileWidth(300, 0, 3)).toBe(100);
    expect(tileWidth(100, 10, 1)).toBe(100);
    expect(tileWidth(100, 10, 2)).toBe(45);
  });

  it('three tiles plus two gaps never exceed the container, for odd and fractional widths', () => {
    const widths = [240, 288, 301, 320, 333.33, 360.5, 375, 392.727, 411.43, 412, 414, 428, 600.1, 1023];
    for (const gap of [4, 6, 8, 10, 12])
      for (const w of widths) {
        const tile = tileWidth(w, gap, 3);
        // layout sums in floats: allow only sub-pixel rounding noise
        expect(tile * 3 + gap * 2, `${w}/${gap}`).toBeLessThanOrEqual(w + 1e-9);
        expect(tile).toBeGreaterThan(0);
      }
  });

  it('the floored tile (what a pixel-snapping layout draws) always fits exactly', () => {
    for (let w = 200; w <= 1100; w += 0.37)
      expect(Math.floor(tileWidth(w, 8, 3)) * 3 + 16).toBeLessThanOrEqual(w);
  });

  it('is monotonic in the container width and shrinks as the gap grows', () => {
    expect(tileWidth(361, 8, 3)).toBeGreaterThan(tileWidth(360, 8, 3));
    expect(tileWidth(360, 12, 3)).toBeLessThan(tileWidth(360, 8, 3));
  });
});
