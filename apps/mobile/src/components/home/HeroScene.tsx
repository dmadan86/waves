/**
 * The dashboard hero's scenery, drawn in layers rather than as one picture:
 *
 *   sky            a gradient, top to bottom, filling the whole hero
 *   orb + sky life the sun or moon with its glow; stars, birds, rays, snow
 *   mountains      two ranges, the far one paler, sized like `cover` — cropped
 *                  from the sides, never stretched — and sat on the horizon
 *   haze           the atmosphere over the ranges' foot
 *   foliage        a branch reaching in from the right and a bush on the left,
 *                  each placed on its own and scaled at its own shape
 *   decorations    what hangs on the foliage — lanterns, small lights, snow
 *   overlay        a shade across the top so the white greeting always reads
 *   fade           the scene's foot running into the page behind the card
 *
 * Everything is vector, so it stays sharp at any width, and every colour comes
 * from the scene's `HeroTheme` (`lib/scene`). The foliage keeps to the band
 * between the greeting row and the balance card and to the edges, so it never
 * sits over the face, the greeting or the icons.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  Line,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import { HERO_THEMES, SceneDecoration, type HeroTheme, type Scene } from '@/lib/scene';

export function HeroScene({
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
  /** Where the greeting row ends: nothing leafy is drawn above it but at the edge. */
  headerBottom: number;
  /** The page behind the hero, which the scene's foot fades into. */
  pageColor: string;
}) {
  const theme = HERO_THEMES[scene];
  if (width <= 0 || height <= 0) return null;

  // The ranges stand on the horizon, a little behind the card so the card's
  // top edge is what they disappear under, and rise about half the open sky.
  const rangeHeight = Math.max(90, horizon * 0.55);
  const rangeBottom = horizon + 28;
  const sun = { x: width * 0.72, y: rangeBottom - rangeHeight * 0.62 };

  // The branch: at most 30% of the width, at its own shape.
  const branchWidth = Math.min(width * 0.3, 150);
  const branchHeight = branchWidth * (BRANCH_VIEW.h / BRANCH_VIEW.w);
  const branchTop = headerBottom + 2;
  // The bush: tucked in the left corner, half behind the card.
  const bushWidth = Math.min(width * 0.28, 130);
  const bushHeight = bushWidth * (BUSH_VIEW.h / BUSH_VIEW.w);
  const bushTop = horizon + 18 - bushHeight;

  const fadeFrom = Math.min(0.95, (horizon + 8) / height);

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { height, overflow: 'hidden' }]}
    >
      {/* Sky */}
      <LinearGradient
        colors={theme.sky}
        locations={[0, 0.5, 1]}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, height: rangeBottom }}
      />
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: rangeBottom - 1,
          bottom: 0,
          backgroundColor: theme.sky[2],
        }}
      />

      {/* Orb and what lives in the sky */}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={theme.orb.glow} stopOpacity="1" />
            <Stop offset="1" stopColor={theme.orb.glow} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <SkyLife theme={theme} width={width} height={height} sun={sun} horizon={horizon} />
        <Circle cx={sun.x} cy={sun.y} r={70} fill="url(#glow)" />
        <Circle cx={sun.x} cy={sun.y} r={theme.orb.moon ? 15 : 19} fill={theme.orb.color} />
        {theme.orb.moon ? (
          <G opacity={0.12} fill={theme.mountains[1]}>
            <Circle cx={sun.x - 5} cy={sun.y - 3} r={3.5} />
            <Circle cx={sun.x + 4} cy={sun.y + 5} r={2.5} />
            <Circle cx={sun.x + 6} cy={sun.y - 6} r={1.8} />
          </G>
        ) : null}
      </Svg>

      {/* Mountains: a `cover` fit — the drawing keeps its shape, and a narrow
          screen crops its sides rather than squeezing the peaks. */}
      <Svg
        width={width}
        height={rangeHeight}
        viewBox={`0 0 ${RANGE_VIEW.w} ${RANGE_VIEW.h}`}
        preserveAspectRatio="xMidYMax slice"
        style={{ position: 'absolute', left: 0, top: rangeBottom - rangeHeight }}
      >
        <Path d={FAR_RANGE} fill={theme.mountains[0]} />
        <Rect x={0} y={80} width={RANGE_VIEW.w} height={80} fill={theme.haze} />
        <Path d={NEAR_RANGE} fill={theme.mountains[1]} />
        {theme.decoration === SceneDecoration.Snow ? (
          <Path d={FAR_SNOW} fill="#FFFFFF" opacity={0.85} />
        ) : null}
        {theme.decoration === SceneDecoration.FairyLights ? (
          <G fill={theme.accent}>
            {SHORE_LIGHTS.map(([x, y], index) => (
              <Circle key={index} cx={x} cy={y} r={0.9} opacity={0.9} />
            ))}
          </G>
        ) : null}
      </Svg>

      {/* Haze over the ranges' foot, so they sit in air rather than on a line. */}
      <LinearGradient
        colors={[`${theme.sky[2]}00`, theme.sky[2]]}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: rangeBottom - rangeHeight * 0.3,
          height: rangeHeight * 0.3 + 1,
        }}
      />

      {/* Foreground foliage, with its decorations, each on its own frame. */}
      <Svg
        width={branchWidth}
        height={branchHeight}
        viewBox={`0 0 ${BRANCH_VIEW.w} ${BRANCH_VIEW.h}`}
        style={{ position: 'absolute', right: 0, top: branchTop }}
      >
        <Branch theme={theme} />
        <BranchDecorations theme={theme} />
      </Svg>
      <Svg
        width={bushWidth}
        height={bushHeight}
        viewBox={`0 0 ${BUSH_VIEW.w} ${BUSH_VIEW.h}`}
        style={{ position: 'absolute', left: -8, top: bushTop }}
      >
        <Bush theme={theme} />
      </Svg>

      {/* Readability: a shade across the top, under the greeting and icons. */}
      <LinearGradient
        colors={[theme.overlay, 'rgba(0, 0, 0, 0)']}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: headerBottom + 40,
        }}
      />

      {/* The foot: the scene runs into the page behind the card, gradually. */}
      <LinearGradient
        colors={[`${pageColor}00`, `${pageColor}99`, pageColor]}
        locations={[fadeFrom, fadeFrom + (1 - fadeFrom) * 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

/** Stars, birds, rays or falling snow — whatever the scene's sky carries. */
function SkyLife({
  theme,
  width,
  height,
  sun,
  horizon,
}: {
  theme: HeroTheme;
  width: number;
  height: number;
  sun: { x: number; y: number };
  horizon: number;
}) {
  switch (theme.decoration) {
    case SceneDecoration.Stars:
      return (
        <G fill={theme.accent}>
          {scatter(28, 7).map(([x, y, s], index) => (
            <Circle
              key={index}
              cx={x * width}
              cy={y * horizon * 0.8}
              r={0.6 + s * 1.1}
              opacity={0.35 + s * 0.6}
            />
          ))}
        </G>
      );
    case SceneDecoration.Snow:
      return (
        <G fill="#FFFFFF">
          {scatter(34, 11).map(([x, y, s], index) => (
            <Circle
              key={index}
              cx={x * width}
              cy={y * height}
              r={1 + s * 1.6}
              opacity={0.5 + s * 0.4}
            />
          ))}
        </G>
      );
    case SceneDecoration.Sunbeams:
      return (
        <G fill={theme.accent} opacity={0.16}>
          {[-150, -125, -100, -75].map((angle) => {
            const a = (angle * Math.PI) / 180;
            const spread = 0.07;
            const reach = width;
            return (
              <Path
                key={angle}
                d={`M${sun.x} ${sun.y} L${sun.x + Math.cos(a - spread) * reach} ${sun.y - Math.sin(a - spread) * reach} L${sun.x + Math.cos(a + spread) * reach} ${sun.y - Math.sin(a + spread) * reach} Z`}
              />
            );
          })}
        </G>
      );
    case SceneDecoration.Birds:
    case SceneDecoration.Lanterns:
      return (
        <G stroke="#2B3553" strokeWidth={1.4} fill="none" opacity={0.45} strokeLinecap="round">
          {[
            [0.42, 0.34, 1],
            [0.48, 0.3, 0.8],
            [0.53, 0.37, 0.7],
          ].map(([x, y, s], index) => (
            <Path
              key={index}
              d={`M0 0 Q${4 * s} ${-4 * s} ${8 * s} 0 Q${12 * s} ${-4 * s} ${16 * s} 0`}
              transform={`translate(${x * width} ${y * horizon})`}
            />
          ))}
        </G>
      );
    default:
      return null;
  }
}

/** A stem sweeping in from the right edge, leaves along it. */
function Branch({ theme }: { theme: HeroTheme }) {
  const { leaf, highlight, stem } = theme.foliage;
  const winter = theme.decoration === SceneDecoration.Snow;
  return (
    <G>
      <Path d={STEM} stroke={stem} strokeWidth={3} fill="none" strokeLinecap="round" />
      <Path d={TWIG} stroke={stem} strokeWidth={2} fill="none" strokeLinecap="round" />
      {LEAVES.map(([x, y, angle, scale], index) => (
        <G key={index} transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`}>
          <Path d={LEAF} fill={leaf} />
          <Path d={LEAF_LIGHT} fill={highlight} opacity={winter ? 0.8 : 0.5} />
          <Line x1={3} y1={0} x2={26} y2={0} stroke={stem} strokeWidth={0.8} opacity={0.45} />
        </G>
      ))}
      {winter ? (
        <G fill="#FFFFFF">
          {STEM_SNOW.map(([x, y, rx], index) => (
            <Ellipse key={index} cx={x} cy={y} rx={rx} ry={rx * 0.45} />
          ))}
        </G>
      ) : null}
    </G>
  );
}

/** What hangs on the branch: paper lanterns at sunset, small lights at dusk. */
function BranchDecorations({ theme }: { theme: HeroTheme }) {
  if (theme.decoration === SceneDecoration.Lanterns) {
    return (
      <G>
        {LANTERNS.map(([x, y, drop], index) => (
          <G key={index}>
            <Line
              x1={x}
              y1={y}
              x2={x}
              y2={y + drop}
              stroke={theme.foliage.stem}
              strokeWidth={0.8}
            />
            <Circle cx={x} cy={y + drop + 7} r={13} fill={theme.accent} opacity={0.22} />
            <Rect x={x - 5.5} y={y + drop} width={11} height={14} rx={5} fill={theme.accent} />
            <Rect x={x - 3.5} y={y + drop - 1} width={7} height={2} fill={theme.foliage.stem} />
            <Rect x={x - 3.5} y={y + drop + 13} width={7} height={2} fill={theme.foliage.stem} />
          </G>
        ))}
      </G>
    );
  }
  if (theme.decoration === SceneDecoration.FairyLights) {
    return (
      <G>
        <Path d={LIGHT_STRING} stroke={theme.foliage.stem} strokeWidth={0.6} fill="none" />
        {FAIRY_LIGHTS.map(([x, y], index) => (
          <G key={index}>
            <Circle cx={x} cy={y} r={4.5} fill={theme.accent} opacity={0.28} />
            <Circle cx={x} cy={y} r={1.8} fill={theme.accent} />
          </G>
        ))}
      </G>
    );
  }
  return null;
}

/** A low bush in the left corner — lumps of leaves, lit from above. */
function Bush({ theme }: { theme: HeroTheme }) {
  const { leaf, highlight } = theme.foliage;
  const winter = theme.decoration === SceneDecoration.Snow;
  return (
    <G>
      {BUSH_LUMPS.map(([x, y, r], index) => (
        <Circle key={index} cx={x} cy={y} r={r} fill={leaf} />
      ))}
      {BUSH_LUMPS.map(([x, y, r], index) => (
        <Circle
          key={`l${index}`}
          cx={x - r * 0.25}
          cy={y - r * 0.35}
          r={r * 0.55}
          fill={highlight}
          opacity={winter ? 0 : 0.28}
        />
      ))}
      {winter
        ? BUSH_LUMPS.map(([x, y, r], index) => (
            <Ellipse
              key={`s${index}`}
              cx={x}
              cy={y - r * 0.72}
              rx={r * 0.78}
              ry={r * 0.32}
              fill="#FFFFFF"
            />
          ))
        : null}
      {theme.decoration === SceneDecoration.FairyLights
        ? BUSH_LUMPS.map(([x, y, r], index) => (
            <G key={`f${index}`}>
              <Circle cx={x + r * 0.2} cy={y - r * 0.3} r={4} fill={theme.accent} opacity={0.28} />
              <Circle cx={x + r * 0.2} cy={y - r * 0.3} r={1.6} fill={theme.accent} />
            </G>
          ))
        : null}
    </G>
  );
}

/** A fixed scatter of points in the unit square, with a size in [0, 1] each —
 *  the same every render, so stars and flakes do not jump about. */
function scatter(count: number, seed: number): [number, number, number][] {
  let state = seed;
  const next = () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
  return Array.from({ length: count }, () => [next(), next(), next()]);
}

const RANGE_VIEW = { w: 400, h: 160 };
const FAR_RANGE =
  'M0 100 Q25 80 50 88 Q80 60 110 50 Q135 62 160 78 Q200 58 235 38 Q265 56 290 70 Q325 52 350 58 Q380 74 400 68 L400 160 L0 160 Z';
const FAR_SNOW =
  'M98 55 Q110 50 122 56 Q114 58 110 62 Q104 58 98 55 Z M222 45 Q235 38 248 46 Q240 48 235 53 Q228 48 222 45 Z M340 60 Q350 58 360 62 Q354 64 350 66 Q345 63 340 60 Z';
const NEAR_RANGE =
  'M0 128 Q30 100 62 110 Q95 122 130 98 Q165 76 205 106 Q240 128 280 104 Q320 84 355 108 Q380 122 400 114 L400 160 L0 160 Z';
const SHORE_LIGHTS: [number, number][] = [
  [140, 130],
  [150, 128],
  [158, 131],
  [170, 129],
  [182, 132],
  [246, 134],
  [256, 131],
  [268, 133],
];

const BRANCH_VIEW = { w: 140, h: 120 };
const STEM = 'M144 6 C 116 12, 84 22, 62 42 C 50 54, 38 64, 20 72';
const TWIG = 'M96 18 C 92 30, 90 40, 84 52';
const LEAF = 'M0 0 C8 -9 22 -9 30 0 C22 9 8 9 0 0 Z';
const LEAF_LIGHT = 'M0 0 C8 -9 22 -9 30 0 C22 -3 8 -3 0 0 Z';
/** x, y, angle (degrees), scale — along the stem and the twig. */
const LEAVES: [number, number, number, number][] = [
  [130, 9, 200, 0.9],
  [124, 11, 110, 1.0],
  [106, 15, 210, 0.85],
  [100, 17, 120, 1.05],
  [84, 52, 95, 0.9],
  [90, 38, 160, 0.85],
  [80, 27, 200, 0.9],
  [74, 31, 115, 1.1],
  [58, 46, 185, 0.9],
  [52, 51, 100, 1.05],
  [36, 63, 165, 0.9],
  [22, 71, 140, 0.85],
];
const STEM_SNOW: [number, number, number][] = [
  [132, 7, 8],
  [112, 12, 9],
  [90, 19, 8],
  [70, 34, 8],
  [52, 50, 7],
  [34, 62, 6],
];
/** x, y on the stem, and how far the lantern hangs below it. */
const LANTERNS: [number, number, number][] = [
  [104, 16, 30],
  [58, 47, 22],
];
const LIGHT_STRING = 'M132 10 Q 118 34, 96 30 Q 80 50, 62 52 Q 46 70, 28 72';
const FAIRY_LIGHTS: [number, number][] = [
  [124, 22],
  [112, 30],
  [100, 31],
  [88, 38],
  [76, 47],
  [64, 52],
  [52, 59],
  [40, 67],
  [30, 71],
];

const BUSH_VIEW = { w: 120, h: 60 };
const BUSH_LUMPS: [number, number, number][] = [
  [18, 44, 20],
  [46, 36, 24],
  [78, 42, 20],
  [102, 50, 15],
];
