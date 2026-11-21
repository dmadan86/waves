/** A progress ring: a soft track and a brand arc, the arc starting at twelve o'clock. */

import type { ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useTheme } from '@waves/ui';

export function GoalRing({
  pct,
  size,
  stroke,
  children,
}: {
  /** 0..100 */
  pct: number;
  size: number;
  stroke: number;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = (Math.max(0, Math.min(100, pct)) / 100) * circumference;
  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={theme.color.brandSoft}
          strokeWidth={stroke}
          fill="none"
        />
        {filled > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={theme.color.brand}
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={`${filled} ${circumference}`}
            strokeLinecap="round"
            rotation={-90}
            origin={`${size / 2}, ${size / 2}`}
          />
        ) : null}
      </Svg>
      {children}
    </View>
  );
}
