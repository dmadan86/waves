/**
 * Which of the Friends hero's five photographs a scene wears.
 *
 * The owner's art is one scene — three friends on a rock, watching a lake and
 * a city — shot at five moments: morning, midday, sunset, dusk, night. Home's
 * clock (`lib/scene`) turns through six: the same five, plus winter, a
 * seasonal theme nobody's camera was there for. This is the fold from one
 * onto the other. Pure, like `sceneFor`, so the mapping is tested without
 * mounting the photo, Reanimated, or the asset pipeline.
 */

import { Scene } from '@/lib/scene';

/** The five moments the photograph was shot at. */
export type FriendsMoment = 'morning' | 'midday' | 'sunset' | 'dusk' | 'night';

/**
 * Home's five daily scenes folded onto the five moments the photo covers:
 * afternoon reads as midday, evening as dusk. Winter — reachable only from
 * the Background screen's own pick, never from the clock — has no shot of
 * its own and borrows midday's, the closest in mood to its pale, snow-lit
 * sky; everything else about winter (the ink, the overlay) still comes from
 * `HERO_THEMES`, only the photo underneath is substituted.
 */
export function friendsMomentFor(scene: Scene): FriendsMoment {
  switch (scene) {
    case Scene.Morning:
      return 'morning';
    case Scene.Sunset:
      return 'sunset';
    case Scene.Evening:
      return 'dusk';
    case Scene.Night:
      return 'night';
    case Scene.Afternoon:
    case Scene.Winter:
      return 'midday';
    default:
      return 'midday';
  }
}
