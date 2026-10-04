/**
 * Which of the Review hero's four photographs a scene wears.
 *
 * The owner's art is one scene — a lakeside desk holding a mug, a purple
 * inbox tray with a ₹ receipt, and a potted plant — shot at four moments:
 * morning, midday, sunset, night. Home's clock (`lib/scene`) turns through
 * six: the same four, plus sunset's own twilight half-step (`evening`) and a
 * seasonal theme nobody's camera was there for (`winter`). This is the fold
 * from one onto the other, the same shape `friendsScene.ts` uses for its own
 * five-shot set. Pure, like `sceneFor`, so the mapping is tested without
 * mounting the photo, Reanimated, or the asset pipeline.
 */

import { Scene } from '@/lib/scene';

/** The four moments the photograph was shot at. */
export type ReviewMoment = 'morning' | 'midday' | 'sunset' | 'night';

/**
 * Home's six scenes folded onto the four moments this shoot covers.
 *
 * `evening` has no shot of its own — there is no dusk frame in this set, only
 * sunset's gold and night's dark blue either side of it — and lands on
 * `night` rather than `sunset`: evening's own palette (`HERO_THEMES.evening`)
 * is already a dark, star-ready purple closer in mood to the night shot than
 * to sunset's still-bright orange. `winter`, reachable only from the
 * Background screen's own pick, borrows `midday`'s pale, cloud-lit sky, the
 * same fold `friendsMomentFor` gives it.
 */
export function reviewMomentFor(scene: Scene): ReviewMoment {
  switch (scene) {
    case Scene.Morning:
      return 'morning';
    case Scene.Sunset:
      return 'sunset';
    case Scene.Evening:
    case Scene.Night:
      return 'night';
    case Scene.Afternoon:
    case Scene.Winter:
      return 'midday';
    default:
      return 'midday';
  }
}
