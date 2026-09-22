/**
 * Three people and a plus — "start a group", as one mark.
 *
 * Drawn rather than picked, because the icon set does not have it. Ionicons
 * offers `people` (two figures) and `person-add` (one figure with the plus
 * already on it), and neither is this: two figures reads as a pair rather than
 * a group, and the single figure names a different feature this app actually
 * has — adding *a person* opens a 1:1 ledger with them, not a group.
 *
 * The arrangement is the conventional one: two behind, one in front and
 * slightly larger, with the plus set off to the trailing side.
 *
 * The front figure is **masked out** of the two behind rather than laid over
 * them. At 22pt the three silhouettes merge into a single blob without that
 * gap, which is the difference between reading "a group" and reading "a
 * smudge". A mask, specifically, and not a cut-out drawn in the background
 * colour: this sits on a translucent disc over a gradient, so there is no
 * background colour to draw with — a solid punch would show as a coloured
 * notch wherever the wash underneath happened to be darkest.
 *
 * Sized in a 28×24 box rather than a square, because the plus needs room to the
 * side and squeezing it into 24 wide would cost the figures their weight.
 */
import Svg, { Circle, G, Mask, Rect } from 'react-native-svg';

/** How far the mask holds the figures behind off the one in front, in user
    units. Enough to separate them at icon sizes, small enough not to hollow
    the group out. */
const GAP = 0.7;

const FRONT = { cx: 9.6, cy: 9.6, r: 2.9, bodyX: 5.6, bodyY: 13.6, w: 8, h: 6.4, rx: 2.9 };

export function GroupAddIcon({ size = 22, color }: { size?: number; color: string }) {
  // The box is 28 wide by 24 tall; the caller sizes by height, the same way an
  // Ionicon's `size` means its line height.
  const width = (size * 28) / 24;
  return (
    <Svg width={width} height={size} viewBox="0 0 28 24" fill="none">
      <Mask id="frontCutout" maskUnits="userSpaceOnUse" x={0} y={0} width={28} height={24}>
        {/* White keeps, black removes. */}
        <Rect x={0} y={0} width={28} height={24} fill="#fff" />
        <Circle cx={FRONT.cx} cy={FRONT.cy} r={FRONT.r + GAP} fill="#000" />
        <Rect
          x={FRONT.bodyX - GAP}
          y={FRONT.bodyY - GAP}
          width={FRONT.w + GAP * 2}
          height={FRONT.h + GAP * 2}
          rx={FRONT.rx + GAP}
          fill="#000"
        />
      </Mask>

      {/* The two behind. Each is a head and a shouldered body; the body is a
          rounded rectangle rather than a true shoulder curve, because at this
          size the curve is one pixel of difference and several of complexity. */}
      <G mask="url(#frontCutout)">
        <Circle cx={6.2} cy={7.4} r={2.6} fill={color} />
        <Rect x={2.7} y={10.6} width={7} height={6} rx={2.6} fill={color} />
        <Circle cx={13} cy={7.4} r={2.6} fill={color} />
        <Rect x={9.5} y={10.6} width={7} height={6} rx={2.6} fill={color} />
      </G>

      <Circle cx={FRONT.cx} cy={FRONT.cy} r={FRONT.r} fill={color} />
      <Rect
        x={FRONT.bodyX}
        y={FRONT.bodyY}
        width={FRONT.w}
        height={FRONT.h}
        rx={FRONT.rx}
        fill={color}
      />

      {/* The plus, on the trailing side. Bars rather than a text glyph, so its
          weight matches the figures' — a "+" at this size reads thinner. */}
      <Rect x={20.25} y={6} width={1.5} height={5.6} rx={0.75} fill={color} />
      <Rect x={18.2} y={8.05} width={5.6} height={1.5} rx={0.75} fill={color} />
    </Svg>
  );
}
