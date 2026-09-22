/**
 * The Waves mark, as the browser draws it.
 *
 * The web was still wearing a rupee sign in a gradient square — a placeholder
 * from before there was a logo, and by the time the launcher, the splash and
 * the adaptive icon had all moved onto the purple (PR #930) it was the only
 * surface left showing something the app does not use anywhere else.
 *
 * The geometry is the supplied original, `infra/art/brand/waves-mark-yellow.svg`
 * — the same square `infra/art/render-splash-mark.py` cuts every launcher icon
 * from. Copied rather than imported because that file is a *build input*: it is
 * kept yellow on purpose (the renderer recovers each pixel's ink coverage from
 * how far it has travelled between the two flat colours, and recolouring it
 * breaks the cut), so shipping it to a browser would ship the wrong colours.
 * What is duplicated here is four numbers and a path, and they move together
 * with that file or not at all.
 *
 * Deliberately **static**. The phone draws this mark on, stroke then dot then
 * swell, because it is filling a whole splash screen and has a second to do it
 * in. A 30px chip in a top bar that redraws itself on every navigation is a
 * different thing, and animating it would be a tic rather than an arrival.
 *
 * The ink is `currentColor`, so the field is whatever the chip around it is
 * painted — `--w-brand-solid`, the one purple that is the same value in both
 * themes, because a logo that changes colour with the theme is two logos.
 */

/** The mark's own canvas, the 512 square the original is drawn on. */
const CANVAS = 512;

/** Ink placement inside that canvas: `translate(76,76) scale(5)` in the source. */
const PLACE = 'translate(76,76) scale(5)';

/** The stroke, in the ink's own coordinates — the "wi" wave. */
const STROKE = 'M10 24 Q17 56 25 42 Q36 22 47 42 Q55 56 62 24';

export function WaveMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${CANVAS} ${CANVAS}`}
      fill="none"
      aria-hidden
      focusable="false"
    >
      <g transform={PLACE}>
        <path
          d={STROKE}
          stroke="currentColor"
          strokeWidth={6}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {/* The full stop the stroke rises to meet. */}
        <circle cx={62} cy={17} r={4} fill="currentColor" />
      </g>
    </svg>
  );
}
