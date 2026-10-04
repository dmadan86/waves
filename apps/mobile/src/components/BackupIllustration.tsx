/**
 * The scene above the daily backup reminder: a cloud carrying the Google
 * Drive mark, a phone sending its records up to it, and the kinds of things
 * that get backed up — a receipt, a photo, a group of people — floating
 * around it.
 *
 * Vector throughout (no raster asset), so it stays sharp at any width and
 * never ships a PNG that drifts from the theme. Only the Drive triangle's
 * three facets keep their official brand colours regardless of light or dark
 * mode — everything else (the cloud, the phone, the floating tiles) reads off
 * the theme, the same rule `HeroScene` follows for its own scenery.
 *
 * The scene itself is drawn once at its natural (roomier) size and then
 * uniformly shrunk by `SCENE_SCALE` about its own centre — not stretched to
 * fit a flatter box, which would squash the cloud and shear the tilted tiles.
 * A smaller scene centred in a shorter box is what keeps the compact popup
 * from looking cramped. The faint dotted threads that used to connect the
 * tiles to the cloud were dropped entirely: they cost vertical room and
 * weren't worth it at this size.
 */

import { View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect } from 'react-native-svg';

import { useTheme } from '@waves/ui';

/** The Drive mark's three official facets — fixed, not themed. */
const DRIVE_GREEN = '#0F9D58';
const DRIVE_YELLOW = '#F4B400';
const DRIVE_BLUE = '#4285F4';

/** The scene is drawn in this fixed box, then scaled down to fit the shorter
 *  viewBox below before being scaled again (by the SVG itself) to fill the
 *  rendered width. */
const VIEW_W = 300;
const VIEW_H = 104;

/** How much smaller the scene is drawn than its original 300×150 box — picked
 *  so the whole composition (cloud top to phone bottom) clears the new 104dp
 *  box with an even margin, uniformly, so nothing in it looks squashed. */
const SCENE_SCALE = 0.75;
/** The scene's own centre in its original coordinate space, and where that
 *  centre lands in the new viewBox once scaled — see the module doc. */
const SCENE_PIVOT = { x: 150, y: 67.5 };
const SCENE_CENTER = { x: 150, y: VIEW_H / 2 };
const SCENE_TRANSFORM =
  `translate(${SCENE_CENTER.x - SCENE_SCALE * SCENE_PIVOT.x}, ` +
  `${SCENE_CENTER.y - SCENE_SCALE * SCENE_PIVOT.y}) scale(${SCENE_SCALE})`;

export function BackupIllustration({ height = VIEW_H }: { height?: number }) {
  const theme = useTheme();
  const cloudFill = theme.color.surfaceMuted;
  const sky = theme.tint.sky.bg;
  const lilac = theme.tint.lilac.bg;
  const pink = theme.tint.pink.bg;

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: '100%', height }}
    >
      <Svg width="100%" height="100%" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
        <G transform={SCENE_TRANSFORM}>
          {/* Floating tiles: receipt (left), photo (top-right), people (right). */}
          <ReceiptTile fill={lilac} ink={theme.color.brand} />
          <PhotoTile fill={sky} ink={theme.color.text} />
          <PeopleTile fill={pink} ink={theme.color.text} />

          {/* The cloud. */}
          <G fill={cloudFill}>
            <Circle cx={116} cy={42} r={23} />
            <Circle cx={176} cy={39} r={25} />
            <Circle cx={147} cy={30} r={21} />
            <Rect x={96} y={52} width={108} height={21} rx={10} />
            <Rect x={96} y={30} width={108} height={22} />
          </G>

          {/* The Drive triangle, centred in the cloud — fixed brand colours. */}
          <Path d="M150,27 L139,45 L150,51 L161,45 Z" fill={DRIVE_BLUE} />
          <Path d="M128,63 L150,63 L150,51 L139,45 Z" fill={DRIVE_GREEN} />
          <Path d="M172,63 L161,45 L150,51 L150,63 Z" fill={DRIVE_YELLOW} />

          {/* The purple up-arrow, phone to cloud. */}
          <Line
            x1={150}
            y1={88}
            x2={150}
            y2={77}
            stroke={theme.color.brand}
            strokeWidth={3}
            strokeLinecap="round"
          />
          <Path d="M150,70 L143,79 L157,79 Z" fill={theme.color.brand} />

          {/* The phone, lying flat. */}
          <G>
            <Rect
              x={111}
              y={90}
              width={78}
              height={36}
              rx={10}
              fill={theme.color.surface}
              stroke={theme.color.border}
              strokeWidth={1.5}
            />
            <Rect x={119} y={97} width={62} height={22} rx={4} fill={theme.color.brandSoft} />
            <Circle cx={119} cy={108} r={1.8} fill={theme.color.border} />
          </G>

          {/* Two small sparkles. */}
          <Sparkle x={72} y={22} fill={theme.color.brand} />
          <Sparkle x={222} y={66} fill={theme.color.brand} scale={0.8} />
        </G>
      </Svg>
    </View>
  );
}

/** Purple receipt tile, tilted, left of the cloud. */
function ReceiptTile({ fill, ink }: { fill: string; ink: string }) {
  return (
    <G transform="translate(38, 68) rotate(-12)">
      <Rect x={-19} y={-24} width={38} height={48} rx={6} fill={fill} />
      <G stroke={ink} strokeWidth={2} strokeLinecap="round" opacity={0.6}>
        <Line x1={-11} y1={-12} x2={11} y2={-12} />
        <Line x1={-11} y1={-4} x2={11} y2={-4} />
        <Line x1={-11} y1={4} x2={4} y2={4} />
      </G>
      <Line x1={-11} y1={14} x2={11} y2={14} stroke={ink} strokeWidth={2.5} strokeLinecap="round" />
    </G>
  );
}

/** Light-blue photo tile, tilted, above and right of the cloud. */
function PhotoTile({ fill, ink }: { fill: string; ink: string }) {
  return (
    <G transform="translate(236, 26) rotate(10)">
      <Rect x={-19} y={-15} width={38} height={30} rx={6} fill={fill} />
      <Circle cx={-8} cy={-5} r={3} fill={ink} opacity={0.55} />
      <Path d="M-13,7 L-3,-3 L5,5 L11,-1 L13,7 Z" fill={ink} opacity={0.4} />
    </G>
  );
}

/** Pink people tile, tilted, right of the cloud. */
function PeopleTile({ fill, ink }: { fill: string; ink: string }) {
  return (
    <G transform="translate(246, 86) rotate(-8)">
      <Rect x={-17} y={-19} width={34} height={38} rx={6} fill={fill} />
      <G fill={ink} opacity={0.55}>
        <Circle cx={-6} cy={-6} r={5} />
        <Path d="M-14,10 Q-6,0 2,10 Z" />
        <Circle cx={7} cy={-2} r={4} />
        <Path d="M0,10 Q7,2 14,10 Z" />
      </G>
    </G>
  );
}

/** A tiny four-point sparkle. */
function Sparkle({
  x,
  y,
  fill,
  scale = 1,
}: {
  x: number;
  y: number;
  fill: string;
  scale?: number;
}) {
  return (
    <Path
      d="M0,-7 L2,-2 L7,0 L2,2 L0,7 L-2,2 L-7,0 L-2,-2 Z"
      fill={fill}
      transform={`translate(${x}, ${y}) scale(${scale})`}
    />
  );
}
