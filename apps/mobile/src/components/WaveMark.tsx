/**
 * The Waves mark, arriving rather than simply being there.
 *
 * Three beats, in order:
 *
 *   1. The stroke inks itself in, left to right, as though drawn by hand.
 *   2. The dot falls onto the end the stroke has just reached.
 *   3. A beat later, a swell of weight travels back through the finished
 *      mark — the ink thickening under itself and thinning again.
 *
 * WHY NONE OF THIS ANIMATES AN SVG PROP. It used to: `strokeDashoffset` for the
 * draw-on, `cy` for the dot, `cx`/`cy`/`r` for the swell, all through
 * `useAnimatedProps`. On a real device, in a release build, not one of them
 * moved. What the phone showed was the mark already finished, static, for the
 * whole splash — and a screen recording is the only place that showed up,
 * because the arithmetic is right and replays correctly off-device.
 *
 * The recording also contained its own control. The field's wash animates on
 * the same shared clock through `useAnimatedStyle`, and it drifted smoothly the
 * whole time. So the worklets ran, the timing ran, reduced motion was off — and
 * the View-style animation worked while the SVG-prop animation did not.
 * Whatever the cause inside `react-native-svg`'s new-architecture prop path,
 * the shape of the fix is the same: animate what is known to animate here.
 *
 * So the SVG below is static — it renders the finished stroke and never changes
 * — and all three beats are Views:
 *
 *   - the stroke is revealed by clipping, an `overflow: 'hidden'` window whose
 *     width grows across the ink's own span;
 *   - the dot is a round View that falls;
 *   - the swell is a round View in the same ink riding the baked polyline,
 *     which over a stroke of constant weight reads as a local thickening.
 *
 * The clip is a vertical edge rather than a true trim along the path, and that
 * is the one honest compromise here: the mark is written left to right and its
 * stroke advances monotonically in x, so the edge tracks the pen closely enough
 * that the eye reads it as drawing. A real trim needs path geometry this
 * platform will not animate for us.
 *
 * On Android 12+ the native splash draws the first two beats itself, from the
 * same geometry (`plugins/withAnimatedSplashMark.js`), and `AnimatedSplash`
 * starts this at `MARK_DRAWN`, so the mark is never erased and drawn again.
 * Anywhere else the native splash shows an undrawn mark and this draws it all.
 *
 * The numbers all come from `assets/brand/wave-mark.json`, written by
 * `infra/art/render-splash-mark.py`. Edit the geometry there and re-run it.
 */
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import GEOM from '../../assets/brand/wave-mark.json';

/** The mark's colour, matching the `INK` the renderer bakes into the PNG.
    White, because the field under it is the brand purple — see `SPLASH_BG` in
    `AnimatedSplash.tsx`, which this has to be legible on and must move with. */
const INK = '#FFFFFF';

/**
 * Where each beat sits, as a fraction of `progress`.
 *
 * The gap between the dot landing and the swell starting is deliberate and is
 * the difference between this reading as one long gesture and as two separate
 * ideas: the mark arrives, and then something moves through it.
 */
const DRAW_END = 0.38;
const DOT_END = 0.47;

/** Where the mark is whole (stroke drawn, dot landed) and only the swell is to
    come: the frame Android 12's native splash ends on, which `AnimatedSplash`
    starts from there (see plugins/withAnimatedSplashMark.js). */
export const MARK_DRAWN = DOT_END;
const SWELL_START = 0.62;

/** How far above its resting place the dot starts its fall, in canvas units.
    Short: it is a full stop landing, not an object thrown in. */
const DOT_RISE = 110;

/** How much fatter the ink gets under the swell, as a multiple of the resting
    stroke. Enough to see; not so much that the mark looks inflated. */
const SWELL_PEAK = 0.95;

const POINTS: readonly (readonly number[])[] = GEOM.points;

/** The resting path, in the geometry's own coordinates. */
const D =
  `M${POINTS[0][0]} ${POINTS[0][1]} ` +
  `Q${POINTS[1][0]} ${POINTS[1][1]} ${POINTS[2][0]} ${POINTS[2][1]} ` +
  `Q${POINTS[3][0]} ${POINTS[3][1]} ${POINTS[4][0]} ${POINTS[4][1]} ` +
  `Q${POINTS[5][0]} ${POINTS[5][1]} ${POINTS[6][0]} ${POINTS[6][1]}`;

/**
 * The placement the renderer uses, in the order it applies it: scale and centre
 * the ink, lean it, then put the bounds back where the lean walked them off
 * centre. SVG measures rotation clockwise; Figma's field, and the renderer, are
 * counter-clockwise.
 */
const TRANSFORM =
  `translate(${GEOM.derived.recentre[0]} ${GEOM.derived.recentre[1]}) ` +
  `rotate(${-GEOM.tiltDeg} ${GEOM.canvas / 2} ${GEOM.canvas / 2}) ` +
  `translate(${GEOM.derived.translate[0]} ${GEOM.derived.translate[1]}) ` +
  `scale(${GEOM.derived.scale})`;

/**
 * The same transform, in arithmetic.
 *
 * The Views have to sit where the SVG will actually paint the ink, and the only
 * way to know that is to apply the transform by hand. It is the one piece of
 * duplication here, and it is why the string above and the function below have
 * to be changed together.
 */
function place(point: readonly number[]): readonly number[] {
  const d = GEOM.derived;
  const c = GEOM.canvas;
  const t = (-GEOM.tiltDeg * Math.PI) / 180;
  const sx = point[0] * d.scale + d.translate[0];
  const sy = point[1] * d.scale + d.translate[1];
  const dx = sx - c / 2;
  const dy = sy - c / 2;
  return [
    c / 2 + dx * Math.cos(t) - dy * Math.sin(t) + d.recentre[0],
    c / 2 + dx * Math.sin(t) + dy * Math.cos(t) + d.recentre[1],
  ];
}

const PLACED: readonly (readonly number[])[] = GEOM.derived.polyline.map(place);
const HALF_STROKE = (GEOM.strokeWidth * GEOM.derived.scale) / 2;

/** The ink's own span in x, so the reveal starts where the stroke starts and
    finishes where it finishes, rather than crossing empty canvas at either end. */
const INK_X0 = Math.min(...PLACED.map((p) => p[0])) - HALF_STROKE;
const INK_X1 = Math.max(...PLACED.map((p) => p[0])) + HALF_STROKE;

const DOT = place([GEOM.dot.cx, GEOM.dot.cy]);
const DOT_R = GEOM.dot.r * GEOM.derived.scale;

export function WaveMark({
  size,
  progress,
}: {
  /** Drawn width. The mark is square, so this is both dimensions. */
  size: number;
  /** 0 to 1, one pass of the whole sequence. Held at 0 nothing is drawn yet. */
  progress: SharedValue<number>;
}) {
  // Canvas units to pixels. Every number above is in the geometry's own canvas;
  // everything laid out below is in pixels.
  const k = size / GEOM.canvas;

  // Beat one: the clip window widens across the ink's span.
  //
  // Eased at both ends rather than only at the finish. The cubic ease-out this
  // inherited from the dash-offset version put 65% of the travel into the first
  // 117ms, which is not a pen drawing a line, it is a line appearing; nobody
  // caught it because nobody had seen this animation run. A hand starts, covers
  // the distance, and settles.
  const clipStyle = useAnimatedStyle(() => {
    const f = Math.min(1, Math.max(0, progress.value / DRAW_END));
    const eased = f < 0.5 ? 4 * f ** 3 : 1 - (-2 * f + 2) ** 3 / 2;
    return { width: (INK_X0 + (INK_X1 - INK_X0) * eased) * k };
  });

  // Beat two: the dot falls the last of its distance under something like
  // gravity, and is simply absent until the stroke has reached it.
  const dotStyle = useAnimatedStyle(() => {
    const t = progress.value;
    if (t < DRAW_END) return { opacity: 0, transform: [{ translateY: -DOT_RISE * k }] };
    const u = Math.min(1, (t - DRAW_END) / (DOT_END - DRAW_END));
    return { opacity: 1, transform: [{ translateY: -DOT_RISE * (1 - u) ** 2 * k }] };
  });

  // Beat three: the swell. A disc rides the baked polyline, its size a bump
  // that rises and falls across the pass, so the ink looks locally heavier
  // rather than a ball looks like it is moving over it.
  const swellStyle = useAnimatedStyle(() => {
    const t = progress.value;
    const u = t < SWELL_START ? 0 : (t - SWELL_START) / (1 - SWELL_START);
    // Where the head of the swell is, run slightly past both ends so it
    // arrives and leaves rather than appearing and vanishing mid-stroke.
    const head = u * 1.3 - 0.15;
    const i = Math.min(PLACED.length - 1, Math.max(0, Math.round(head * (PLACED.length - 1))));
    const env = Math.sin(Math.PI * u);
    return {
      opacity: t < SWELL_START || head < 0 || head > 1 ? 0 : 1,
      transform: [
        { translateX: (PLACED[i][0] - HALF_STROKE) * k },
        { translateY: (PLACED[i][1] - HALF_STROKE) * k },
        { scale: 1 + SWELL_PEAK * env },
      ],
    };
  });

  return (
    <View style={{ width: size, height: size }}>
      {/* The clip window. The SVG inside keeps its full width and is pinned to
          the left, so narrowing the window uncovers the mark rather than
          squashing it. */}
      <Animated.View style={[{ height: size, overflow: 'hidden' }, clipStyle]}>
        <Svg
          width={size}
          height={size}
          viewBox={`0 0 ${GEOM.canvas} ${GEOM.canvas}`}
          style={{ position: 'absolute', left: 0, top: 0 }}
        >
          <Path
            d={D}
            transform={TRANSFORM}
            stroke={INK}
            strokeWidth={GEOM.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </Svg>
      </Animated.View>

      {/* The dot is a View rather than part of the SVG, because it has to fall
          after the clip has already passed the place it lands. */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            left: (DOT[0] - DOT_R) * k,
            top: (DOT[1] - DOT_R) * k,
            width: DOT_R * 2 * k,
            height: DOT_R * 2 * k,
            borderRadius: DOT_R * k,
            backgroundColor: INK,
          },
          dotStyle,
        ]}
      />

      <Animated.View
        style={[
          {
            position: 'absolute',
            left: 0,
            top: 0,
            width: HALF_STROKE * 2 * k,
            height: HALF_STROKE * 2 * k,
            borderRadius: HALF_STROKE * k,
            backgroundColor: INK,
          },
          swellStyle,
        ]}
      />
    </View>
  );
}
