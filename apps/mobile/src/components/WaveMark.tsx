/**
 * The Waves mark, drawn as geometry rather than as a picture, so it can arrive
 * rather than simply be there.
 *
 * Three beats, in order:
 *
 *   1. The stroke inks itself in, left to right, as though drawn by hand.
 *   2. The dot falls onto the end the stroke has just reached.
 *   3. A beat later, a swell of weight travels back through the finished
 *      mark — the ink thickening under itself and thinning again.
 *
 * The third beat is why this is geometry and not an image, but it is also the
 * one thing SVG will not do directly: a `<Path>` has one `strokeWidth` for its
 * whole length, so a swell that travels cannot be a stroke at all. It is a
 * disc instead, in the same ink, riding the path and growing as it goes — laid
 * over a stroke of constant weight, a local thickening is exactly what that
 * reads as. `derived.polyline` is the track it rides, baked by the renderer so
 * it follows the same curve the stroke does.
 *
 * Because the mark is drawn on, the native splash must NOT also be showing it
 * — see `app.json`, where `expo-splash-screen` is given a colour and no image.
 * If a mark is put back there, this component will appear to erase the logo
 * the launch had already finished showing and draw it again, which is the seam
 * the splash was rebuilt to remove.
 *
 * The numbers all come from `assets/brand/wave-mark.json`, written by
 * `infra/art/render-splash-mark.py`. Edit the geometry there and re-run it.
 */
import Svg, { Circle, Path } from 'react-native-svg';
import Animated, { useAnimatedProps, type SharedValue } from 'react-native-reanimated';

import GEOM from '../../assets/brand/wave-mark.json';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** The ink, matching the `INK` the renderer bakes into the PNG. */
const INK = '#2B2B20';

/**
 * Where each beat sits, as a fraction of `progress`.
 *
 * The gap between the dot landing and the swell starting is deliberate and is
 * the difference between this reading as one long gesture and as two separate
 * ideas: the mark arrives, and then something moves through it.
 */
const DRAW_END = 0.38;
const DOT_END = 0.47;
const SWELL_START = 0.62;

/** How high above its resting place the dot starts its fall, in geometry
    units. Short: it is a full stop landing, not an object thrown in. */
const DOT_RISE = 16;

/** How much fatter the ink gets under the swell, as a multiple of the resting
    stroke. Enough to see; not so much that the mark looks inflated. */
const SWELL_PEAK = 0.95;

const POINTS: readonly (readonly number[])[] = GEOM.points;
const POLY: readonly (readonly number[])[] = GEOM.derived.polyline;
const LEN = GEOM.derived.pathLength;

/** The resting path. It never changes shape now — only how much of it is
    inked, and what is riding on top of it. */
const D =
  `M${POINTS[0][0]} ${POINTS[0][1]} ` +
  `Q${POINTS[1][0]} ${POINTS[1][1]} ${POINTS[2][0]} ${POINTS[2][1]} ` +
  `Q${POINTS[3][0]} ${POINTS[3][1]} ${POINTS[4][0]} ${POINTS[4][1]} ` +
  `Q${POINTS[5][0]} ${POINTS[5][1]} ${POINTS[6][0]} ${POINTS[6][1]}`;

export function WaveMark({
  size,
  progress,
}: {
  /** Drawn width, which must match `imageWidth` in `app.json`. */
  size: number;
  /** 0 to 1, one pass of the whole sequence. Held at 0 nothing is drawn yet. */
  progress: SharedValue<number>;
}) {
  const d = GEOM.derived;
  const canvas = GEOM.canvas;

  // The placement the renderer uses, in the order it applies it: scale and
  // centre the ink, lean it, then put the bounds back where the lean walked
  // them off centre.
  const transform =
    `translate(${d.recentre[0]} ${d.recentre[1]}) ` +
    // SVG measures rotation clockwise; Figma's field, and the renderer, are
    // counter-clockwise.
    `rotate(${-GEOM.tiltDeg} ${canvas / 2} ${canvas / 2}) ` +
    `translate(${d.translate[0]} ${d.translate[1]}) scale(${d.scale})`;

  // Beat one: the dash offset walks from the stroke's full length to zero, so
  // the ink appears from the near end. Eased out, because a pen slows as the
  // line finishes rather than stopping dead.
  const strokeProps = useAnimatedProps(() => {
    const t = progress.value;
    const f = Math.min(1, Math.max(0, t / DRAW_END));
    return { strokeDashoffset: LEN * (1 - (1 - (1 - f) ** 3)) };
  });

  // Beat two: the dot falls the last of its distance under something like
  // gravity, and is simply absent until the stroke has reached it.
  const dotProps = useAnimatedProps(() => {
    const t = progress.value;
    if (t < DRAW_END) return { cy: GEOM.dot.cy - DOT_RISE, opacity: 0 };
    const u = Math.min(1, (t - DRAW_END) / (DOT_END - DRAW_END));
    return { cy: GEOM.dot.cy - DOT_RISE * (1 - u) ** 2, opacity: 1 };
  });

  // Beat three: the swell. A disc rides the baked polyline, its radius a bump
  // that rises and falls across the pass, so the ink looks locally heavier
  // rather than a ball looks like it is moving over it.
  const swellProps = useAnimatedProps(() => {
    const t = progress.value;
    const u = t < SWELL_START ? 0 : (t - SWELL_START) / (1 - SWELL_START);
    // Where the head of the swell is, run slightly past both ends so it
    // arrives and leaves rather than appearing and vanishing mid-stroke.
    const head = u * 1.3 - 0.15;
    const i = Math.min(POLY.length - 1, Math.max(0, Math.round(head * (POLY.length - 1))));
    const env = Math.sin(Math.PI * u);
    // Every branch returns the same keys: a worklet that returns two different
    // shapes gives the animated component a union it cannot apply.
    return {
      cx: POLY[i][0],
      cy: POLY[i][1],
      r: (GEOM.strokeWidth / 2) * (1 + SWELL_PEAK * env),
      opacity: t < SWELL_START || head < 0 || head > 1 ? 0 : 1,
    };
  });

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${canvas} ${canvas}`}>
      <AnimatedPath
        animatedProps={strokeProps}
        d={D}
        transform={transform}
        stroke={INK}
        strokeWidth={GEOM.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={[LEN, LEN]}
        fill="none"
      />
      <AnimatedCircle
        animatedProps={dotProps}
        transform={transform}
        cx={GEOM.dot.cx}
        r={GEOM.dot.r}
        fill={INK}
      />
      <AnimatedCircle animatedProps={swellProps} transform={transform} fill={INK} />
    </Svg>
  );
}
