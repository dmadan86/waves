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

  it('turns at the half hours it says it does', () => {
    expect(sceneFor(at(8, 18, 29))).toBe(Scene.Sunset);
    expect(sceneFor(at(8, 18, 30))).toBe(Scene.Evening);
    expect(sceneFor(at(8, 20, 30))).toBe(Scene.Night);
    expect(sceneFor(at(8, 4, 59))).toBe(Scene.Night);
    expect(sceneFor(at(8, 5, 0))).toBe(Scene.Morning);
  });

  it('snows on winter daytimes only', () => {
    expect(sceneFor(at(11, 9))).toBe(Scene.Winter);
    expect(sceneFor(at(0, 14))).toBe(Scene.Winter);
    expect(sceneFor(at(1, 17))).toBe(Scene.Sunset);
    expect(sceneFor(at(0, 23))).toBe(Scene.Night);
    expect(sceneFor(at(2, 9))).toBe(Scene.Morning);
  });
});
