/** A small flat illustration of a property type, drawn in the theme's brand blues. */

import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';

import type { PropertyType } from '@waves/core';
import { useTheme } from '@waves/ui';

import { artKind } from '@/lib/wealthPlan';

const TREE = '#7CCBA8';

export function PropertyArt({
  type,
  width = 120,
  height = 100,
}: {
  type: PropertyType;
  width?: number;
  height?: number;
}) {
  const { color } = useTheme();
  const b = color.brand;
  const soft = color.brandSoft;
  const wall = color.surface;
  const kind = artKind(type);
  return (
    <Svg
      width={width}
      height={height}
      viewBox="0 0 120 100"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Ellipse cx="50" cy="40" rx="42" ry="26" fill={soft} opacity={0.9} />
      {kind === 'shop' ? (
        <>
          <Rect x="22" y="44" width="62" height="40" fill={wall} stroke={b} strokeWidth="2" />
          <Path d="M16 44 L22 26 H84 L90 44 Z" fill={b} />
          <Path
            d="M16 44 Q24 52 32 44 Q40 52 48 44 Q56 52 64 44 Q72 52 80 44 Q85 50 90 44"
            fill={b}
            stroke={wall}
            strokeWidth="1.5"
          />
          <Rect x="30" y="56" width="14" height="28" fill={soft} stroke={b} strokeWidth="1.5" />
          <Rect x="52" y="56" width="24" height="14" fill={soft} stroke={b} strokeWidth="1.5" />
        </>
      ) : kind === 'building' ? (
        <>
          <Rect x="28" y="16" width="44" height="68" fill={wall} stroke={b} strokeWidth="2" />
          <Rect x="72" y="38" width="16" height="46" fill={soft} stroke={b} strokeWidth="2" />
          {[24, 40, 56].flatMap((y) =>
            [35, 52].map((x) => (
              <Rect key={`${x}${y}`} x={x} y={y} width="10" height="10" fill={b} opacity={0.85} />
            )),
          )}
          <Rect x="44" y="70" width="12" height="14" fill={soft} stroke={b} strokeWidth="1.5" />
        </>
      ) : kind === 'room' ? (
        <>
          <Rect
            x="18"
            y="50"
            width="70"
            height="22"
            rx="4"
            fill={wall}
            stroke={b}
            strokeWidth="2"
          />
          <Rect
            x="22"
            y="38"
            width="24"
            height="14"
            rx="4"
            fill={soft}
            stroke={b}
            strokeWidth="2"
          />
          <Rect x="18" y="38" width="6" height="46" rx="2" fill={b} />
          <Rect x="82" y="58" width="6" height="26" rx="2" fill={b} />
          <Rect x="52" y="42" width="30" height="10" rx="4" fill={b} opacity={0.85} />
        </>
      ) : kind === 'land' ? (
        <>
          <Path d="M14 84 L34 56 H90 L100 84 Z" fill={soft} stroke={b} strokeWidth="2" />
          <Path d="M48 56 L52 84 M70 56 L76 84" stroke={b} strokeWidth="1" opacity={0.5} />
          <Rect x="40" y="38" width="3" height="26" fill={b} />
          <Rect x="40" y="38" width="20" height="12" rx="2" fill={b} />
        </>
      ) : (
        <>
          <Rect x="28" y="46" width="52" height="38" fill={wall} stroke={b} strokeWidth="2" />
          <Path d="M20 48 L54 20 L88 48 Z" fill={b} />
          <Rect x="48" y="60" width="14" height="24" fill={soft} stroke={b} strokeWidth="1.5" />
          <Rect x="34" y="54" width="10" height="10" fill={soft} stroke={b} strokeWidth="1.5" />
        </>
      )}
      <Path d="M10 84 H104" stroke={b} strokeWidth="2" strokeLinecap="round" />
      <Rect x="101" y="62" width="2.5" height="22" fill={TREE} />
      <Circle cx="102" cy="58" r="9" fill={TREE} />
    </Svg>
  );
}
