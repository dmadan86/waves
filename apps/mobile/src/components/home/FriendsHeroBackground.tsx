/**
 * Friends' hero background: the same three friends on the same rock, over the
 * same lake and city, at five moments of one day — morning, midday, sunset,
 * dusk, night. Where Home's hero is drawn in vector layers (`HeroScene`),
 * this one is a photograph, because the owner's own art is this scene and
 * redrawing it as shapes would lose the thing that makes it theirs.
 *
 *   photo    the scene, `cover`-fitted and anchored bottom-centre, so the
 *            three friends and the horizon stay in frame on a short hero
 *            rather than being trimmed the way a centred crop would
 *   crossfade  when the moment changes under a running clock, the new
 *            photo eases in over the old one rather than cutting to it;
 *            skipped under reduced motion, which jumps straight there
 *   scrim    Home's own top shade for this scene (`HERO_THEMES[scene].overlay`),
 *            so the white title and the status bar read the same way they
 *            do over Home's sky, on every one of the five photos
 *   fade     the photo's foot running into the page behind the glass card,
 *            Home's own formula
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

import { friendsMomentFor, type FriendsMoment } from '@/lib/friendsScene';
import { HERO_THEMES, Scene } from '@/lib/scene';
import { useReducedMotion } from '@/lib/reducedMotion';

/** The five photographs, one per moment. */
const FRIENDS_SCENE_PHOTOS: Readonly<Record<FriendsMoment, number>> = {
  morning: require('../../../assets/images/scenes/friends/morning.webp') as number,
  midday: require('../../../assets/images/scenes/friends/midday.webp') as number,
  sunset: require('../../../assets/images/scenes/friends/sunset.webp') as number,
  dusk: require('../../../assets/images/scenes/friends/dusk.webp') as number,
  night: require('../../../assets/images/scenes/friends/night.webp') as number,
};

/** Each photo's own pixel size, so `cover` can be computed by hand rather
 *  than trusted to the native `resizeMode`, which centres vertically too and
 *  would risk trimming the friends' heads on a short, wide hero. */
const FRIENDS_SCENE_SIZE: Readonly<Record<FriendsMoment, { width: number; height: number }>> = {
  morning: { width: 1080, height: 397 },
  midday: { width: 1080, height: 397 },
  sunset: { width: 1080, height: 472 },
  dusk: { width: 1080, height: 473 },
  night: { width: 1080, height: 472 },
};

const CROSSFADE_MS = 400;

export function FriendsHeroBackground({
  scene,
  width,
  height,
  horizon,
  headerBottom,
  pageColor,
}: {
  scene: Scene;
  /** The hero's size: the screen's width, and down to where the scene ends. */
  width: number;
  height: number;
  /** Where the balance card's top edge sits — the landscape's ground line. */
  horizon: number;
  /** Where the greeting row ends — Home's own measure for how tall the top
   *  shade runs. */
  headerBottom: number;
  /** The page behind the hero, which the photo's foot fades into. */
  pageColor: string;
}) {
  const moment = friendsMomentFor(scene);
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);

  // The photo showing at full strength, and — only while a change is under
  // way — the one dissolving in over it. Two layers rather than a swap, so
  // the moment change reads as the same light sliding past rather than a cut.
  const [shown, setShown] = useState(moment);
  const [incoming, setIncoming] = useState<FriendsMoment | null>(null);

  // Adjusted during render, not in an effect: the sanctioned way to derive
  // state from a changed prop without the extra committed frame an effect
  // would cost, and `moment !== incoming` stops it from re-arming on every
  // render while a crossfade is already under way. Reduced motion jumps
  // straight to `shown`; everyone else first shows up as `incoming`, and the
  // effect below carries it the rest of the way.
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
      // Interrupted by a newer moment arriving mid-fade: `finished` is false,
      // and the effect this triggers (dep `incoming` having changed) is the
      // one that gets to call `finish`.
      if (finished) runOnJS(finish)();
    };
    progress.set(0);
    progress.set(withTiming(1, { duration: CROSSFADE_MS }, settle));
  }, [incoming, reduceMotion, progress]);

  const incomingStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));

  if (width <= 0 || height <= 0) return null;

  // Home's own formula (`HeroScene`): the photo's foot runs into the page
  // behind the card, starting a little above the card's top edge.
  const fadeFrom = Math.min(0.95, (horizon + 8) / height);

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        StyleSheet.absoluteFill,
        { height, overflow: 'hidden', backgroundColor: HERO_THEMES[scene].sky[0] },
      ]}
    >
      <CoverPhoto moment={shown} width={width} height={height} />
      {incoming ? (
        <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, incomingStyle]}>
          <CoverPhoto moment={incoming} width={width} height={height} />
        </Reanimated.View>
      ) : null}

      {/* Readability: the same top shade Home's own hero wears for this
          scene, so the white title and the status bar read the same way
          over the photo as they do over the drawn sky. */}
      <LinearGradient
        colors={[HERO_THEMES[scene].overlay, 'rgba(0, 0, 0, 0)']}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: headerBottom + 40,
        }}
      />

      {/* The foot: the photo runs into the page behind the card, gradually —
          Home's own stops. */}
      <LinearGradient
        colors={[`${pageColor}00`, `${pageColor}99`, pageColor]}
        locations={[fadeFrom, fadeFrom + (1 - fadeFrom) * 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

/** One photo, `cover`-fitted by hand and anchored bottom-centre — centred
 *  side to side, its foot held to the hero's foot — so the three friends and
 *  the horizon they are watching stay in frame rather than being centred
 *  into, which on a short hero would crop their heads instead of the sky
 *  above them. */
function CoverPhoto({
  moment,
  width,
  height,
}: {
  moment: FriendsMoment;
  width: number;
  height: number;
}) {
  const size = FRIENDS_SCENE_SIZE[moment];
  const scale = Math.max(width / size.width, height / size.height);
  const renderedWidth = size.width * scale;
  const renderedHeight = size.height * scale;
  return (
    <Image
      source={FRIENDS_SCENE_PHOTOS[moment]}
      style={{
        position: 'absolute',
        width: renderedWidth,
        height: renderedHeight,
        left: (width - renderedWidth) / 2,
        top: height - renderedHeight,
      }}
    />
  );
}
