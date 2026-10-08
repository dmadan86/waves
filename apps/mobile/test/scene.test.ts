import { describe, expect, it } from 'vitest';

import { HOME_HEROES } from '@/lib/homeHeroPure';
import { parseScene, Scene, sceneFor, sceneForHero } from '@/lib/scene';

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
    expect(sceneFor(at(8, 4, 59))).toBe(Scene.Night);
    expect(sceneFor(at(8, 5, 0))).toBe(Scene.Morning);
    expect(sceneFor(at(8, 7, 59))).toBe(Scene.Morning);
    expect(sceneFor(at(8, 8, 0))).toBe(Scene.Afternoon);
    expect(sceneFor(at(8, 16, 0))).toBe(Scene.Sunset);
    expect(sceneFor(at(8, 18, 29))).toBe(Scene.Sunset);
    expect(sceneFor(at(8, 18, 30))).toBe(Scene.Evening);
    expect(sceneFor(at(8, 20, 59))).toBe(Scene.Evening);
    expect(sceneFor(at(8, 21, 0))).toBe(Scene.Night);
  });

  it('keeps winter dawn out of the daily cycle, even in December', () => {
    expect(sceneFor(at(11, 7))).toBe(Scene.Morning);
    expect(sceneFor(at(0, 14))).toBe(Scene.Afternoon);
  });

  it('wears winter dawn on daytimes only when the seasonal theme is on', () => {
    expect(sceneFor(at(11, 9), { seasonal: true })).toBe(Scene.Winter);
    expect(sceneFor(at(11, 14), { seasonal: true })).toBe(Scene.Winter);
    expect(sceneFor(at(11, 17), { seasonal: true })).toBe(Scene.Sunset);
    expect(sceneFor(at(11, 23), { seasonal: true })).toBe(Scene.Night);
  });

  it('lets an override win over the clock and the season', () => {
    expect(sceneFor(at(8, 13), { override: Scene.Night })).toBe(Scene.Night);
    expect(sceneFor(at(11, 9), { seasonal: true, override: Scene.Sunset })).toBe(Scene.Sunset);
    expect(sceneFor(at(8, 13), { override: null })).toBe(Scene.Afternoon);
  });

  it('reads an override only when it names a scene', () => {
    expect(parseScene('winter')).toBe(Scene.Winter);
    expect(parseScene('noon')).toBeNull();
    expect(parseScene(undefined)).toBeNull();
  });
});

describe('sceneForHero', () => {
  it('keeps Automatic automatic', () => {
    expect(sceneForHero(null)).toBeNull();
  });

  it('maps each photograph to the nearest painted scene', () => {
    expect(sceneForHero('morning')).toBe(Scene.Morning);
    expect(sceneForHero('late-morning')).toBe(Scene.Afternoon);
    expect(sceneForHero('afternoon')).toBe(Scene.Afternoon);
    expect(sceneForHero('evening')).toBe(Scene.Evening);
    expect(sceneForHero('sunset')).toBe(Scene.Sunset);
    expect(sceneForHero('night')).toBe(Scene.Night);
    expect(sceneForHero('rainy')).toBe(Scene.Evening);
    expect(sceneForHero('autumn')).toBe(Scene.Afternoon);
    expect(sceneForHero('spring')).toBe(Scene.Afternoon);
  });

  it('never returns winter', () => {
    for (const hero of HOME_HEROES) expect(sceneForHero(hero)).not.toBe(Scene.Winter);
  });
});
