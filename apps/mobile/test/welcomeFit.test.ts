import { describe, expect, it } from 'vitest';

import { welcomeFit } from '../src/lib/welcomeFitPure';

describe('welcomeFit', () => {
  it('hides the picture and scrolls when nothing is left (SE 667, large text)', () => {
    const r = welcomeFit({ stage: 0, windowWidth: 375, windowHeight: 667 });
    expect(r).toMatchObject({ showFriends: false, friendsH: 0, needsScroll: true });
    expect(r.headlineW).toBeLessThan(375 * 0.53);
    expect(welcomeFit({ stage: 0, windowWidth: 390, windowHeight: 844 }).needsScroll).toBe(true);
  });
  it('shrinks the picture into what is left (812)', () => {
    const r = welcomeFit({ stage: 150, windowWidth: 375, windowHeight: 812 });
    expect(r.showFriends).toBe(true);
    expect(r.friendsH).toBe(142);
    expect(r.friendsW / r.friendsH).toBeCloseTo(1200 / 614);
    expect(r.needsScroll).toBe(false);
  });
  it('fits 844', () => {
    const r = welcomeFit({ stage: 200, windowWidth: 390, windowHeight: 844 });
    expect(r.friendsH).toBe(192);
    expect(r.headlineW).toBeCloseTo(390 * 0.53);
  });
  it('keeps the tall look unchanged (932)', () => {
    const r = welcomeFit({ stage: 330, windowWidth: 430, windowHeight: 932 });
    expect(r.friendsH).toBeCloseTo(430 * 1.08 * (614 / 1200));
    expect(r.headlineW).toBeCloseTo(430 * 0.53);
  });
});
