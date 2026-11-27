import { describe, expect, it } from 'vitest';

import { introFit, introStage } from '../src/lib/introFitPure';

const phones = [
  { name: '667', width: 375, height: 667, top: 20, bottom: 0 },
  { name: '812', width: 375, height: 812, top: 44, bottom: 34 },
  { name: '844', width: 390, height: 844, top: 47, bottom: 34 },
  { name: '932', width: 430, height: 932, top: 59, bottom: 34 },
];
const EN = { titleLen: 18, bodyLen: 46 };
// Tamil runs roughly 2.5x longer than the English subtitle.
const TA = { titleLen: 30, bodyLen: 120 };

describe('introFit', () => {
  it('keeps the tall look: full art on 932', () => {
    const p = phones[3]!;
    const stage = introStage({
      height: p.height,
      width: p.width,
      topInset: p.top,
      bottomInset: p.bottom,
      ...EN,
    });
    const r = introFit({ stage, windowWidth: p.width });
    expect(r.showArt).toBe(true);
    expect(r.artSize).toBe(270);
  });
  it.each(phones)('never overruns the controls on $name, English and Tamil', (p) => {
    for (const copy of [EN, TA]) {
      for (const fontScale of [1, 1.3]) {
        const stage = introStage({
          height: p.height,
          width: p.width,
          topInset: p.top,
          bottomInset: p.bottom,
          fontScale,
          ...copy,
        });
        const r = introFit({ stage, windowWidth: p.width });
        // The picture only ever takes what is free, and an overflowing card scrolls.
        expect(r.artSize * 0.86).toBeLessThanOrEqual(Math.max(stage, 0) + 0.001);
        expect(r.showArt || r.needsScroll || stage < 120).toBe(true);
      }
    }
  });
  it('hides the picture and scrolls on a small screen with a long Tamil subtitle at large text', () => {
    const p = { ...phones[0]!, height: 300 };
    const stage = introStage({
      height: p.height,
      width: p.width,
      topInset: p.top,
      bottomInset: p.bottom,
      fontScale: 1.3,
      ...TA,
    });
    expect(stage).toBe(0);
    expect(introFit({ stage, windowWidth: p.width })).toMatchObject({
      showArt: false,
      artSize: 0,
      needsScroll: true,
    });
  });
  it('shrinks the picture on a 568 pt screen with long Tamil at large text', () => {
    const p = { ...phones[0]!, height: 568 };
    const stage = introStage({
      height: p.height,
      width: p.width,
      topInset: p.top,
      bottomInset: p.bottom,
      fontScale: 1.3,
      ...TA,
    });
    const r = introFit({ stage, windowWidth: p.width });
    expect(r.artSize).toBeLessThan(270);
  });
});
