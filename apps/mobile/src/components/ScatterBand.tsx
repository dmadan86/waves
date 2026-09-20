/**
 * The scatter: a band of the app's own marks, landing and then moving.
 *
 * What is scattered is not confetti. Every glyph is a thing the app is for — a
 * receipt, a plane, a bowl, a house, a card — drawn in the six tints the rest of
 * the app dresses its categories in. So a door can say what the app does twice,
 * once in its headline and once in the objects above it.
 *
 * **It lives in a band of its own, and that is the point.** As a backdrop behind
 * a whole screen it put a house through "No account needed to start" and a card
 * through the body copy: a backdrop you cannot read the page through is not a
 * backdrop. Bounded and clipped, it cannot reach the words, and the page keeps
 * the shape the reference has — the picture above, everything you read below.
 *
 * The motion is three slow loops per mark, each on its own clock:
 *
 *   - a bob, up and back;
 *   - a sway, across and back, over a longer period than the bob;
 *   - a tilt, a few degrees either side, longer still.
 *
 * Three periods that do not divide into each other never line up, so the mark
 * traces a slow wandering path instead of a visible there-and-back. That is the
 * difference between something that moves and something that repeats — and it
 * is why the first version, one ten-point bob, read as static.
 *
 * Everything is on the UI thread (Reanimated shared values driving transforms
 * only), so a dozen marks cost nothing on the cheap phone somebody actually
 * owns. Motion-gated: with animation off every mark is simply in place, because
 * the arrangement is the picture and only the movement is decoration.
 */

import { useEffect } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useTheme, type TintName } from '@waves/ui';

import { useReducedMotion } from '@/lib/reducedMotion';

export interface ScatterMarkSpec {
  icon: keyof typeof Ionicons.glyphMap;
  tint: TintName;
  /** Where the mark sits, as a fraction of the band it is given. */
  x: number;
  y: number;
  /** The disc's diameter. The glyph inside is drawn at 45% of it. */
  size: number;
  /** One full bob, up and back, in seconds. The sway and the tilt are derived
      from it — see `SWAY_FACTOR` and `TILT_FACTOR`. */
  seconds: number;
}

/**
 * The door's arrangement: six marks around the space between the header and the
 * headline, weighted to the corners so the middle stays open.
 */
export const DOOR_SCATTER: readonly ScatterMarkSpec[] = [
  { icon: 'receipt-outline', tint: 'peach', x: 0.06, y: 0.1, size: 54, seconds: 7 },
  { icon: 'airplane-outline', tint: 'sky', x: 0.76, y: 0.04, size: 60, seconds: 9 },
  { icon: 'fast-food-outline', tint: 'coral', x: 0.4, y: 0.0, size: 46, seconds: 8 },
  { icon: 'home-outline', tint: 'mint', x: 0.2, y: 0.52, size: 50, seconds: 11 },
  { icon: 'cafe-outline', tint: 'lilac', x: 0.62, y: 0.45, size: 44, seconds: 6 },
  { icon: 'card-outline', tint: 'pink', x: 0.86, y: 0.58, size: 42, seconds: 10 },
];

/**
 * The form's arrangement: fewer marks and smaller ones, pushed to the two
 * edges. A sign-in page is a thing you are trying to get through, so its band
 * is a quieter version of the door's rather than the same picture again — and
 * the middle is left clear for the title that sits under it.
 */
export const FORM_SCATTER: readonly ScatterMarkSpec[] = [
  { icon: 'receipt-outline', tint: 'peach', x: 0.04, y: 0.12, size: 44, seconds: 8 },
  { icon: 'people-outline', tint: 'sky', x: 0.82, y: 0.06, size: 48, seconds: 11 },
  { icon: 'cafe-outline', tint: 'lilac', x: 0.3, y: 0.46, size: 38, seconds: 7 },
  { icon: 'card-outline', tint: 'pink', x: 0.66, y: 0.5, size: 40, seconds: 9 },
];

/** How far a mark travels on its bob. Small enough to read as breathing. */
const DRIFT = 12;
/** How far it wanders sideways. Less than the bob, so the path reads upright. */
const SWAY = 8;
/** How far it tilts, in degrees, either side of square. */
const TILT = 7;

/** The sway and the tilt run longer than the bob, and by ratios that do not
    divide into it — 1.6 and 2.3 rather than 2 and 3 — so the three loops never
    come back into phase and the path never visibly repeats. */
const SWAY_FACTOR = 1.6;
const TILT_FACTOR = 2.3;

/** Between one mark landing and the next. A twelfth of a second reads as a
    scatter arriving rather than as separate events. */
const STAGGER_MS = 80;

/** After the last mark lands, before the drifting starts. The two motions are
    never on screen together, so neither muddles the other. */
const SETTLE_MS = 400;

export function ScatterBand({
  marks = DOOR_SCATTER,
  minHeight = 150,
}: {
  marks?: readonly ScatterMarkSpec[];
  /**
   * The band is `flex: 1` in its column, so it takes whatever is left over and
   * never pushes its neighbours off. This floor stops it collapsing to nothing
   * on a short screen, where it would read as a rendering fault rather than as
   * a smaller picture.
   */
  minHeight?: number;
}): React.JSX.Element {
  const still = useReducedMotion();

  return (
    <View pointerEvents="none" style={{ flex: 1, minHeight, overflow: 'hidden' }}>
      {marks.map((mark, index) => (
        <ScatterMark key={`${mark.icon}-${index}`} mark={mark} index={index} still={still} />
      ))}
    </View>
  );
}

function ScatterMark({
  mark,
  index,
  still,
}: {
  mark: ScatterMarkSpec;
  index: number;
  still: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  const land = useSharedValue(still ? 1 : 0);
  // Each loop runs -1 → 1 rather than 0 → 1, so the mark's resting place is the
  // middle of its travel and the arrangement on screen is the one laid out
  // above, not one edge of a wobble.
  const bob = useSharedValue(0);
  const sway = useSharedValue(0);
  const tilt = useSharedValue(0);

  useEffect(() => {
    if (still) return;

    // A spring rather than a curve: a mark that overshoots a little and settles
    // reads as dropped into place, which is the difference between a scatter
    // arriving and a layer being faded up.
    land.value = withDelay(index * STAGGER_MS, withSpring(1, { damping: 11, stiffness: 140 }));

    const after = index * STAGGER_MS + SETTLE_MS;
    /** One loop out and back, starting from the middle of its travel. */
    const loop = (seconds: number) =>
      withDelay(
        after,
        withRepeat(
          withTiming(1, { duration: seconds * 1000, easing: Easing.inOut(Easing.quad) }),
          -1,
          // Reversed rather than restarted, so the mark returns along its own
          // path instead of snapping back to where it began.
          true,
        ),
      );

    bob.value = -1;
    sway.value = -1;
    tilt.value = -1;
    bob.value = loop(mark.seconds);
    sway.value = loop(mark.seconds * SWAY_FACTOR);
    tilt.value = loop(mark.seconds * TILT_FACTOR);

    return () => {
      cancelAnimation(land);
      cancelAnimation(bob);
      cancelAnimation(sway);
      cancelAnimation(tilt);
    };
  }, [bob, index, land, mark.seconds, still, sway, tilt]);

  const style = useAnimatedStyle(() => ({
    opacity: land.value,
    transform: [
      { translateY: DRIFT * bob.value },
      { translateX: SWAY * sway.value },
      { rotate: `${TILT * tilt.value}deg` },
      { scale: 0.6 + 0.4 * land.value },
    ],
  }));

  const tint = theme.tint[mark.tint];

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          // Percentages rather than measured points: the band is whatever the
          // screen leaves it, and the arrangement should hold on a small phone
          // and on a tablet without either measuring or a second table of
          // numbers.
          left: `${mark.x * 100}%`,
          top: `${mark.y * 100}%`,
          width: mark.size,
          height: mark.size,
          borderRadius: mark.size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: tint.bg,
        },
        style,
      ]}
    >
      <Ionicons name={mark.icon} size={Math.round(mark.size * 0.45)} color={tint.ink} />
    </Animated.View>
  );
}
