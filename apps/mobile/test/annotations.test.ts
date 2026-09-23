/**
 * Receipt markup is read back from a database column a determined client could
 * have written by hand, so the parser is the trust boundary: it clamps, caps
 * and drops, and never throws.
 */

import { describe, expect, it } from 'vitest';

import {
  containRect,
  EMPTY_ANNOTATIONS,
  isEmptyAnnotations,
  parseAnnotations,
} from '../src/lib/annotations';

describe('parseAnnotations', () => {
  it('reads anything that is not an object as an empty overlay', () => {
    for (const raw of [null, undefined, 0, 'strokes', true]) {
      expect(parseAnnotations(raw)).toBe(EMPTY_ANNOTATIONS);
    }
    expect(parseAnnotations({})).toEqual({ strokes: [], texts: [] });
    expect(parseAnnotations({ strokes: 'x', texts: 5 })).toEqual({ strokes: [], texts: [] });
  });

  it('keeps a well-formed stroke and text exactly as drawn', () => {
    const raw = {
      strokes: [{ color: '#2563EB', width: 0.02, points: [0.1, 0.2, 0.3, 0.4] }],
      texts: [{ x: 0.5, y: 0.6, color: '#fff', size: 0.05, text: 'tip' }],
    };
    expect(parseAnnotations(raw)).toEqual(raw);
  });

  it('clamps coordinates into the image and sizes into a sane range', () => {
    const parsed = parseAnnotations({
      strokes: [{ color: '#111827', width: 9, points: [-1, 2, Number.NaN, 'x'] }],
      texts: [{ x: 7, y: -3, color: '#111827', size: 0, text: 'hi' }],
    });
    expect(parsed.strokes[0]).toEqual({ color: '#111827', width: 0.5, points: [0, 1, 0, 0] });
    expect(parsed.texts[0]).toMatchObject({ x: 1, y: 0, size: 0.001 });
  });

  it('falls back to defaults for a missing size and a colour that is not a hex', () => {
    const parsed = parseAnnotations({
      strokes: [{ color: 'red; background:url(x)', points: [0.5, 0.5] }],
      texts: [{ color: '#12345', text: 'note' }],
    });
    expect(parsed.strokes[0]).toEqual({ color: '#EF4444', width: 0.01, points: [0.5, 0.5] });
    expect(parsed.texts[0]).toEqual({ x: 0, y: 0, color: '#EF4444', size: 0.01, text: 'note' });
  });

  it('drops strokes without a point and texts without words', () => {
    const parsed = parseAnnotations({
      strokes: [null, 'x', { points: 'nope' }, { points: [0.1] }],
      texts: [null, 4, { text: '   ' }, { text: 12 }],
    });
    expect(isEmptyAnnotations(parsed)).toBe(true);
  });

  it('caps the counts and lengths so a huge blob cannot swamp the renderer', () => {
    const stroke = { color: '#16A34A', width: 0.01, points: Array(5000).fill(0.5) };
    const text = { x: 0, y: 0, color: '#16A34A', size: 0.01, text: 'a'.repeat(500) };
    const parsed = parseAnnotations({
      strokes: Array(400).fill(stroke),
      texts: Array(100).fill(text),
    });
    expect(parsed.strokes).toHaveLength(300);
    expect(parsed.strokes[0]!.points).toHaveLength(2000);
    expect(parsed.texts).toHaveLength(60);
    expect(parsed.texts[0]!.text).toHaveLength(200);
  });
});

describe('isEmptyAnnotations', () => {
  it('is false once there is a single stroke or a single text', () => {
    expect(isEmptyAnnotations(EMPTY_ANNOTATIONS)).toBe(true);
    expect(isEmptyAnnotations({ strokes: [], texts: [{} as never] })).toBe(false);
    expect(isEmptyAnnotations({ strokes: [{} as never], texts: [] })).toBe(false);
  });
});

describe('containRect', () => {
  it('letterboxes a wide image top and bottom', () => {
    expect(containRect({ w: 100, h: 100 }, { w: 200, h: 100 })).toEqual({
      x: 0,
      y: 25,
      w: 100,
      h: 50,
    });
  });

  it('pillarboxes a tall image left and right', () => {
    expect(containRect({ w: 100, h: 100 }, { w: 50, h: 100 })).toEqual({
      x: 25,
      y: 0,
      w: 50,
      h: 100,
    });
  });

  it('uses the whole box until the natural size is known', () => {
    expect(containRect({ w: 80, h: 60 }, { w: 0, h: 0 })).toEqual({ x: 0, y: 0, w: 80, h: 60 });
    expect(containRect({ w: 0, h: 60 }, { w: 10, h: 10 })).toEqual({ x: 0, y: 0, w: 0, h: 60 });
  });
});
