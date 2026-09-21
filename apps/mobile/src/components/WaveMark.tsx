/**
 * The Waves mark, drawn as geometry rather than as a picture, so a wave can
 * actually travel through it.
 *
 * The launch is two pictures back to back. The native half draws
 * `splash-mark-ink.png`, which is baked by `infra/art/render-splash-mark.py`;
 * this half draws the same mark as an SVG path. Both read their numbers from
 * `assets/brand/wave-mark.json` — the points, the stroke, the dot, the tilt,
 * and the exact scale and offsets the PNG was placed with — so the two halves
 * land on the same pixels and the handoff has nothing to give away. Edit the
 * geometry there and re-run the renderer; never nudge one half alone.
 *
 * The motion: the mark *is* a wave, so a crest runs through it. Each point
 * along the stroke lags the one before it, which is what a travelling wave is;
 * the dot lags the far end by a little more again, so it bobs a beat after the
 * crest has passed beneath it rather than moving with it.
 *
 * The amplitude is enveloped by a half-sine, which matters more than it
 * sounds: it is zero at both ends, so the mark begins at exactly the shape the
 * native splash was holding and returns to exactly that shape before the field
 * lifts. Nothing springs in and nothing is left mid-swell — the rule the rest
 * of the splash is built on (see `AnimatedSplash`), expressed in geometry.
 */
import Svg, { Circle, Path } from 'react-native-svg';
import Animated, {
  useAnimatedProps,
  type SharedValue,
} from 'react-native-reanimated';

import GEOM from '../../assets/brand/wave-mark.json';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** The ink, matching the `INK` the renderer bakes into the PNG. */
const INK = '#2B2B20';

/** How far a crest lifts the stroke, in the geometry's own units. The glyph is
    about 36 units tall, so this is a swell the eye reads as movement without
    the mark ever stopping looking like itself. */
const AMPLITUDE = 3.4;

/** How far behind the stroke's far end the dot rides, as a fraction of the
    wave. Enough to read as "the wave passed under it", little enough that the
    two still look joined. */
const DOT_LAG = 0.18;

const POINTS: readonly (readonly number[])[] = GEOM.points;
const X0 = POINTS[0][0];
const SPAN = POINTS[POINTS.length - 1][0] - X0;

/** Where each point sits along the wave, 0 at the near end and 1 at the far
    one. This is the lag: a point at `u` peaks `u` of a cycle after the first. */
const U = POINTS.map((p) => (p[0] - X0) / SPAN);

export function WaveMark({
  size,
  progress,
}: {
  /** Drawn width, which must match `imageWidth` in `app.json`. */
  size: number;
  /** 0 to 1, one pass of the crest. Held at 0 the mark is exactly at rest. */
  progress: SharedValue<number>;
}) {
  const d = GEOM.derived;
  const canvas = GEOM.canvas;

  // The placement the PNG was baked with, in the order the renderer applied
  // it: scale and centre the ink, lean it, then put the bounds back where the
  // lean walked them off centre.
  const transform =
    `translate(${d.recentre[0]} ${d.recentre[1]}) ` +
    // SVG measures rotation clockwise; Figma's field, and the renderer, are
    // counter-clockwise.
    `rotate(${-GEOM.tiltDeg} ${canvas / 2} ${canvas / 2}) ` +
    `translate(${d.translate[0]} ${d.translate[1]}) scale(${d.scale})`;

  const pathProps = useAnimatedProps(() => {
    const t = progress.value;
    // Zero at both ends: the mark starts and finishes on the still frame.
    const amp = AMPLITUDE * Math.sin(Math.PI * t);
    const y = (i: number) =>
      POINTS[i][1] + amp * Math.sin(2 * Math.PI * (t - U[i]));
    return {
      d:
        `M${POINTS[0][0]} ${y(0)} ` +
        `Q${POINTS[1][0]} ${y(1)} ${POINTS[2][0]} ${y(2)} ` +
        `Q${POINTS[3][0]} ${y(3)} ${POINTS[4][0]} ${y(4)} ` +
        `Q${POINTS[5][0]} ${y(5)} ${POINTS[6][0]} ${y(6)}`,
    };
  });

  const dotProps = useAnimatedProps(() => {
    const t = progress.value;
    const amp = AMPLITUDE * Math.sin(Math.PI * t);
    return {
      cy: GEOM.dot.cy + amp * Math.sin(2 * Math.PI * (t - (1 + DOT_LAG))),
    };
  });

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${canvas} ${canvas}`}>
      <AnimatedPath
        animatedProps={pathProps}
        transform={transform}
        stroke={INK}
        strokeWidth={GEOM.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <AnimatedCircle
        animatedProps={dotProps}
        transform={transform}
        cx={GEOM.dot.cx}
        r={GEOM.dot.r}
        fill={INK}
      />
    </Svg>
  );
}
