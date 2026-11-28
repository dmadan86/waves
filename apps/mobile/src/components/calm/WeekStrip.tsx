/** Seven days: a ring per day (spent vs the daily pace), a dot under days with a bill due. */

import Svg, { Circle } from 'react-native-svg';
import { View } from 'react-native';

import { Row, Text, useTheme } from '@waves/ui';

import type { WeekDay } from '@/lib/calm/weekPace';

const SIZE = 36;
const STROKE = 3;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

export function WeekStrip({
  days,
  weekdayLetter,
  dayLabel,
}: {
  days: readonly WeekDay[];
  /** The one-letter weekday, localised. */
  weekdayLetter: (weekday: number) => string;
  /** The spoken label for a day ("Tuesday 24, ₹420 spent"). */
  dayLabel: (day: WeekDay) => string;
}) {
  const theme = useTheme();
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      {days.map((d) => {
        const ink = d.over ? theme.color.warning : theme.color.brand;
        const track = d.state === 'future' ? theme.color.border : theme.color.brandSoft;
        return (
          <View
            key={d.date}
            accessible
            accessibilityLabel={dayLabel(d)}
            style={{ alignItems: 'center', gap: 4, flex: 1 }}
          >
            <Text variant="micro" tone="muted">
              {weekdayLetter(d.weekday)}
            </Text>
            <View
              style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' }}
            >
              <Svg
                width={SIZE}
                height={SIZE}
                style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}
              >
                <Circle
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={R}
                  stroke={track}
                  strokeWidth={STROKE}
                  fill="none"
                />
                {d.fill > 0 ? (
                  <Circle
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={R}
                    stroke={ink}
                    strokeWidth={STROKE}
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={`${CIRC * d.fill} ${CIRC}`}
                  />
                ) : null}
              </Svg>
              <Text
                variant="caption"
                style={{
                  fontWeight: d.state === 'today' ? '800' : '600',
                  color: d.state === 'future' ? theme.color.textFaint : theme.color.text,
                }}
              >
                {Number(d.date.slice(8, 10))}
              </Text>
            </View>
            <View
              style={{
                width: 5,
                height: 5,
                borderRadius: 3,
                backgroundColor: d.due ? theme.color.brand : 'transparent',
              }}
            />
          </View>
        );
      })}
    </Row>
  );
}
