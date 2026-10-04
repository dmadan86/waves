/**
 * Review's hero background: a lakeside desk — a mug, the purple inbox tray
 * a ₹ receipt sits in, a potted plant — shot at four moments of one day:
 * morning, midday, sunset, night. The same shape `FriendsHeroBackground`
 * uses for its own photo, cut down to what this hero needs: there is no
 * balance card riding up over the foot of it here, so there is no "fade into
 * the page" to compute — the band is a fixed height and the tabs start clean
 * below it.
 *
 *   photo    the scene, `cover`-fitted and anchored to the band's right
 *            edge (`FOCAL_X`), where the desk — the mug, the tray, the
 *            plant — sits in every one of the four shots, so a narrow phone
 *            crops sky rather than the things this screen is actually about
 *   crossfade  when the moment changes under a running clock, the new photo
 *            eases in over the old one; skipped under reduced motion, which
 *            jumps straight there
 *   scrim    a steady dark wash across the whole band, not just a strip
 *            under the title — the waiting count sits lower than a title
 *            row does, and morning and midday are bright enough at every
 *            height that white text wants a backer all the way down
 *
 * Decorative only: hidden from screen readers, and never in front of a figure.
 */

import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import type { ReviewMoment } from '@/lib/reviewScene';
import { useReducedMotion } from '@/lib/reducedMotion';

/**
 * Where the desk sits, right of centre in every one of the four shots (the
 * same composition, only the light changes) — a single fraction so one
 * number covers all four rather than one crop per scene.
 */
const FOCAL_X = 0.78;

const CROSSFADE_MS = 400;

/** The four photographs, one per moment. */
const REVIEW_SCENE_PHOTOS: Readonly<Record<ReviewMoment, number>> = {
  morning: require('../../assets/images/scenes/review/morning.webp') as number,
  midday: require('../../assets/images/scenes/review/midday.webp') as number,
  sunset: require('../../assets/images/scenes/review/sunset.webp') as number,
  night: require('../../assets/images/scenes/review/night.webp') as number,
};

/** Each photo's own pixel size, so `cover` can be computed by hand — see
 *  `FriendsHeroBackground`'s own copy of this reasoning. */
const REVIEW_SCENE_SIZE: Readonly<Record<ReviewMoment, { width: number; height: number }>> = {
  morning: { width: 1080, height: 453 },
  midday: { width: 1080, height: 457 },
  sunset: { width: 1080, height: 454 },
  night: { width: 1080, height: 458 },
};

export function ReviewHeroBackground({
  moment,
  width,
  height,
}: {
  moment: ReviewMoment;
  /** The band's own size: the screen's width, and down to where it ends
   *  (the tabs start right below). */
  width: number;
  height: number;
}) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);

  const [shown, setShown] = useState(moment);
  const [incoming, setIncoming] = useState<ReviewMoment | null>(null);

  // Derived during render rather than in an effect — see
  // `FriendsHeroBackground` for the reasoning, shared verbatim here.
  if (moment !== shown && moment !== incoming) {
    if (reduceMotion) {
      setShown(moment);
      setIncoming(null);
    } else {
      setIncoming(moment);
    }
  }

  useEffect(() => {
    if (incoming === null || reduceMotion) return;
    const settled = incoming;
    const finish = () => {
      setShown(settled);
      setIncoming(null);
    };
    const settle = (finished?: boolean) => {
      'worklet';
      if (finished) runOnJS(finish)();
    };
    progress.set(0);
    progress.set(withTiming(1, { duration: CROSSFADE_MS }, settle));
  }, [incoming, reduceMotion, progress]);

  const incomingStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));

  if (width <= 0 || height <= 0) return null;

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { height, overflow: 'hidden' }]}
    >
      <CoverPhoto moment={shown} width={width} height={height} />
      {incoming ? (
        <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, incomingStyle]}>
          <CoverPhoto moment={incoming} width={width} height={height} />
        </Reanimated.View>
      ) : null}

      {/* A steady wash, not a strip under the title alone: "Waiting on you"
          and the count beneath it sit well past where a header-only scrim
          would stop, and every one of the four shots is bright enough at
          that height to need the same backer the title does. Slightly
          stronger at the very top, where the status bar's own glyphs read
          against it too. */}
      <LinearGradient
        colors={['rgba(8, 12, 28, 0.48)', 'rgba(8, 12, 28, 0.36)', 'rgba(8, 12, 28, 0.3)']}
        locations={[0, 0.4, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

/** One photo, `cover`-fitted by hand and anchored on `FOCAL_X` so the desk
 *  stays in frame on a narrow phone instead of being split with the lake. */
function CoverPhoto({
  moment,
  width,
  height,
}: {
  moment: ReviewMoment;
  width: number;
  height: number;
}) {
  const size = REVIEW_SCENE_SIZE[moment];
  const scale = Math.max(width / size.width, height / size.height);
  const renderedWidth = size.width * scale;
  const renderedHeight = size.height * scale;
  const visibleFraction = Math.min(1, width / renderedWidth);
  const leftFraction = Math.max(0, Math.min(1 - visibleFraction, FOCAL_X - visibleFraction / 2));
  return (
    <Image
      source={REVIEW_SCENE_PHOTOS[moment]}
      style={{
        position: 'absolute',
        width: renderedWidth,
        height: renderedHeight,
        left: -leftFraction * renderedWidth,
        top: (height - renderedHeight) / 2,
      }}
    />
  );
}
