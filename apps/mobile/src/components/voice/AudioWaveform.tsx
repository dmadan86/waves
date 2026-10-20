/**
 * The listening wave: filled, symmetric lobes mirrored about the centre line.
 * Each layer is a closed ribbon that swells into humps and pinches to a hairline
 * between them, tapering to a point at both ends; layered over one pink→cyan
 * gradient, the overlaps build a bright core. Layers differ in wavelength
 * (`cycles`), phase, height (`amp`) and opacity so the wave reads as one living
 * body. One looping phase and the eased 0…1 input `level` drive every layer on
 * the UI thread; under reduced motion it is one static ribbon, no loop.
 */

import { useEffect, useMemo } from 'react';
import { useWindowDimensions, View } from 'react-native';
import Reanimated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

/** The waveform's drawing box; the width is clamped to the screen. */
const WAVE_W = 300;
const WAVE_H = 72;
/** Side room kept on a small phone. */
const WAVE_GUTTER = 24;

const WAVE_GRADIENT = 'url(#ecoWaveGrad)';

const WAVE_LAYERS = [
  { id: 'l0', fill: WAVE_GRADIENT, cycles: 1.1, phase: 0.0, amp: 0.62, opacity: 0.42 },
  { id: 'l1', fill: WAVE_GRADIENT, cycles: 1.7, phase: 0.9, amp: 0.82, opacity: 0.4 },
  { id: 'l2', fill: WAVE_GRADIENT, cycles: 1.0, phase: 1.9, amp: 1.0, opacity: 0.4 },
  { id: 'l3', fill: WAVE_GRADIENT, cycles: 2.1, phase: 2.7, amp: 0.72, opacity: 0.4 },
  { id: 'l4', fill: WAVE_GRADIENT, cycles: 1.5, phase: 3.6, amp: 0.9, opacity: 0.42 },
  // The hot core: a bright, low, tight ribbon on top.
  { id: 'core', fill: '#F0F9FF', cycles: 1.5, phase: 1.2, amp: 0.34, opacity: 0.9 },
] as const;

type WaveLayerSpec = (typeof WAVE_LAYERS)[number];

const AnimatedPath = Reanimated.createAnimatedComponent(Path);

/**
 * One layer's closed path for the current phase: the top edge left→right, then
 * the mirrored bottom edge right→left, closed into a filled ribbon. Runs on the
 * UI thread — the body of a `useAnimatedProps` worklet.
 */
function wavePath(width: number, phase: number, level: number, layer: WaveLayerSpec): string {
  'worklet';
  const points = 72;
  const cy = WAVE_H / 2;
  const breath = 0.85 + 0.15 * Math.sin(phase * 2 + layer.phase);
  // Loudness drives the height: a quiet mic keeps a low idling ribbon (40%), a
  // loud voice pushes it to full. With no volume events `level` stays 0.
  const loud = 0.4 + 0.6 * level;
  const reach = (WAVE_H / 2 - 1) * layer.amp * breath * loud;
  let top = '';
  let bottom = '';
  for (let i = 0; i <= points; i++) {
    const frac = i / points;
    const x = (frac * width).toFixed(2);
    const env = Math.exp(-Math.pow((frac - 0.5) / 0.34, 2));
    const hump = Math.abs(Math.sin(frac * layer.cycles * Math.PI * 2 + phase + layer.phase));
    // 0.05 keeps a hairline through the middle so the lobes read as one wave.
    const h = env * reach * (0.05 + 0.95 * hump);
    top += `${i === 0 ? 'M' : 'L'}${x} ${(cy - h).toFixed(2)} `;
    // Prepend the bottom edge so it reads right→left once appended after the top.
    bottom = `L${x} ${(cy + h).toFixed(2)} ${bottom}`;
  }
  return `${top}${bottom}Z`;
}

function WaveLayer({
  width,
  phase,
  level,
  layer,
}: {
  width: number;
  phase: SharedValue<number>;
  level: SharedValue<number>;
  layer: WaveLayerSpec;
}) {
  const animatedProps = useAnimatedProps(() => ({
    d: wavePath(width, phase.value, level.value, layer),
  }));
  return <AnimatedPath animatedProps={animatedProps} fill={layer.fill} opacity={layer.opacity} />;
}

function WaveDefs() {
  return (
    <Defs>
      {/* Pink → violet → blue → cyan, left to right. */}
      <LinearGradient id="ecoWaveGrad" x1="0" y1="0" x2="1" y2="0">
        <Stop offset="0" stopColor="#F472B6" />
        <Stop offset="0.28" stopColor="#C084FC" />
        <Stop offset="0.52" stopColor="#818CF8" />
        <Stop offset="0.74" stopColor="#38BDF8" />
        <Stop offset="1" stopColor="#22D3EE" />
      </LinearGradient>
    </Defs>
  );
}

function LiveWave({ width, level }: { width: number; level: SharedValue<number> }) {
  const phase = useSharedValue(0);
  useEffect(() => {
    phase.value = 0;
    // 0 → 2π on a loop; both the hump and the breath terms are seamless there.
    phase.value = withRepeat(
      withTiming(Math.PI * 2, { duration: 2400, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(phase);
  }, [phase]);
  return (
    <Svg width={width} height={WAVE_H}>
      <WaveDefs />
      {WAVE_LAYERS.map((layer) => (
        <WaveLayer key={layer.id} width={width} phase={phase} level={level} layer={layer} />
      ))}
    </Svg>
  );
}

function StaticWave({ width }: { width: number }) {
  const paths = useMemo(() => WAVE_LAYERS.map((l) => wavePath(width, 0.6, 0.5, l)), [width]);
  return (
    <Svg width={width} height={WAVE_H}>
      <WaveDefs />
      {WAVE_LAYERS.map((layer, i) => (
        <Path key={layer.id} d={paths[i]} fill={layer.fill} opacity={layer.opacity} />
      ))}
    </Svg>
  );
}

export function AudioWaveform({
  level,
  reduceMotion,
}: {
  level: SharedValue<number>;
  reduceMotion: boolean;
}) {
  const { width: screenW } = useWindowDimensions();
  const width = Math.max(120, Math.min(WAVE_W, screenW - WAVE_GUTTER * 2));
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {reduceMotion ? <StaticWave width={width} /> : <LiveWave width={width} level={level} />}
    </View>
  );
}

/** The waveform's box, reserved even when it is not drawn, so nothing jumps. */
export const WAVEFORM_HEIGHT = WAVE_H;
