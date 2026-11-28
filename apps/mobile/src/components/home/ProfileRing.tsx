import type { ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Text, useTheme } from '@waves/ui';

const RING = 48;
const STROKE = 3;

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
  return (
    <View style={{ width: RING, height: RING, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={RING} height={RING} style={{ position: 'absolute' }}>
        <Circle
          cx={RING / 2}
          cy={RING / 2}
          r={r}
          stroke={solid ? theme.color.border : 'rgba(255,255,255,0.6)'}
          strokeWidth={STROKE}
          fill="none"
        />
        <Circle
          cx={RING / 2}
          cy={RING / 2}
          r={r}
          stroke={theme.color.brand}
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
