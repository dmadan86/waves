import { describe, expect, it } from 'vitest';

import { Scene, sceneFor } from '@/lib/scene';

const at = (month: number, hour: number, minute = 0) => new Date(2026, month, 15, hour, minute);

describe('sceneFor', () => {
  it('follows the day', () => {
    expect(sceneFor(at(8, 7))).toBe(Scene.Morning);
    expect(sceneFor(at(8, 13))).toBe(Scene.Afternoon);
    expect(sceneFor(at(8, 17))).toBe(Scene.Sunset);
    expect(sceneFor(at(8, 19))).toBe(Scene.Evening);
    expect(sceneFor(at(8, 22))).toBe(Scene.Night);
    expect(sceneFor(at(8, 3))).toBe(Scene.Night);
  });

  it('turns exactly on the spec’s boundaries', () => {
    expect(sceneFor(at(8, 5, 59))).toBe(Scene.Night);
    expect(sceneFor(at(8, 6, 0))).toBe(Scene.Morning);
    expect(sceneFor(at(8, 9, 59))).toBe(Scene.Morning);
    expect(sceneFor(at(8, 10, 0))).toBe(Scene.Afternoon);
    expect(sceneFor(at(8, 16, 0))).toBe(Scene.Sunset);
    expect(sceneFor(at(8, 18, 29))).toBe(Scene.Sunset);
    expect(sceneFor(at(8, 18, 30))).toBe(Scene.Evening);
    expect(sceneFor(at(8, 19, 59))).toBe(Scene.Evening);
    expect(sceneFor(at(8, 20, 0))).toBe(Scene.Night);
  });

  it('keeps winter dawn out of the daily cycle, even in December', () => {
    expect(sceneFor(at(11, 9))).toBe(Scene.Morning);
    expect(sceneFor(at(0, 14))).toBe(Scene.Afternoon);
  });

  it('wears winter dawn on daytimes only when the seasonal theme is on', () => {
    expect(sceneFor(at(11, 9), { seasonal: true })).toBe(Scene.Winter);
    expect(sceneFor(at(11, 14), { seasonal: true })).toBe(Scene.Winter);
    expect(sceneFor(at(11, 17), { seasonal: true })).toBe(Scene.Sunset);
    expect(sceneFor(at(11, 23), { seasonal: true })).toBe(Scene.Night);
  });
});
