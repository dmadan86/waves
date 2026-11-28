import type { ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Text, useTheme } from '@waves/ui';

import { ringColors } from './ringColors';

const RING = 48;
const STROKE = 3.5;

/** A progress ring around the avatar, with a small percent pill on its bottom edge. */
export function ProfileRing({
  percent,
  solid,
  children,
}: {
  percent: number;
  solid: boolean;
  children: ReactNode;
}) {
  const theme = useTheme();
  const r = (RING - STROKE) / 2;
  const c = 2 * Math.PI * r;
  const colors = ringColors(solid, theme);
  return (
    <View
      style={{ width: RING, height: RING, marginBottom: 6, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width={RING} height={RING} style={{ position: 'absolute' }}>
        <Circle
          cx={RING / 2}
          cy={RING / 2}
          r={r}
          stroke={colors.track}
          strokeWidth={STROKE}
          fill="none"
        />
        <Circle
          cx={RING / 2}
          cy={RING / 2}
          r={r}
          stroke={colors.arc}
          strokeWidth={STROKE}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${(c * percent) / 100} ${c}`}
          transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
        />
      </Svg>
      {children}
      <View
        style={{
          position: 'absolute',
          bottom: -5,
          paddingHorizontal: 5,
          borderRadius: 8,
          borderWidth: 1.5,
          borderColor: '#fff',
          backgroundColor: theme.color.brand,
        }}
      >
        <Text style={{ color: '#fff', fontSize: 10, lineHeight: 14, fontWeight: '700' }}>
          {percent}%
        </Text>
      </View>
    </View>
  );
}
