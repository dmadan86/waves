/**
 * The three pictures on the Spending screen: the sparkline under the total, the
 * donut of where it went, and the month-by-month columns.
 *
 * All three draw figures they are handed — already one currency, already the
 * ledger's own totals — and only decide how they look. The arithmetic of
 * ticks, slices and curves is `lib/spendingChart`, where it is tested.
 */

import { useState } from 'react';
import { Pressable, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { Text, useTheme } from '@waves/ui';

import {
  arcPath,
  compactNumber,
  niceTicks,
  smoothPath,
  type DonutSlice,
} from '@/lib/spendingChart';

/** A soft purple area under a smooth line; the last point wears a dot. */
export function Sparkline({ values, height = 64 }: { values: readonly number[]; height?: number }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
  const dot = 5;
  const largest = Math.max(...values, 1);
  const usable = height - dot * 2 - 4;
  const points =
    width > 0 && values.length > 1
      ? values.map((value, index) => ({
          x: dot + (index / (values.length - 1)) * (width - dot * 2),
          y: dot + 2 + usable - (value / largest) * usable,
        }))
      : [];
  const line = smoothPath(points, height);
  const last = points[points.length - 1];
  return (
    <View
      onLayout={onLayout}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height }}
    >
      {last ? (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={theme.color.brand} stopOpacity={0.28} />
              <Stop offset="1" stopColor={theme.color.brand} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Path
            d={`${line} L ${last.x} ${height} L ${points[0]!.x} ${height} Z`}
            fill="url(#spark)"
          />
          <Path
            d={line}
            stroke={theme.color.brand}
            strokeWidth={2}
            fill="none"
            strokeLinecap="round"
          />
          <Circle cx={last.x} cy={last.y} r={dot} fill={theme.color.brand} />
        </Svg>
      ) : null}
    </View>
  );
}

/** Slice colours by rank, as the mockup has them; everything else is the grey. */
export const RANK_COLORS = ['#6E9BF0', '#F7C58F', '#F29494', '#9D8CF2', '#7DD3E8'] as const;
export const REST_COLOR = '#D5D8E0';

export interface DonutPart {
  key: string;
  /** A theme tint's ink, or null for the "everything else" slice. */
  color: string | null;
}

/** A ring of slices with the total in the middle and a percentage on each big one. */
export function Donut({
  slices,
  centre,
  caption,
  size = 150,
}: {
  slices: readonly DonutSlice<DonutPart>[];
  centre: string;
  caption: string;
  size?: number;
}) {
  const stroke = size * 0.27;
  const r = (size - stroke) / 2;
  const c = size / 2;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size }}
    >
      <Svg width={size} height={size}>
        {slices.map(({ item, start, end }) => {
          const color = item.color ?? REST_COLOR;
          return end - start >= Math.PI * 2 - 0.001 ? (
            <Circle
              key={item.key}
              cx={c}
              cy={c}
              r={r}
              stroke={color}
              strokeWidth={stroke}
              fill="none"
            />
          ) : (
            <Path
              key={item.key}
              d={arcPath(c, c, r, start, end)}
              stroke={color}
              strokeWidth={stroke}
              fill="none"
            />
          );
        })}
      </Svg>
      {slices.map(({ item, start, end, percent }) => {
        if (percent < 4 || item.color === null) return null;
        const mid = (start + end) / 2;
        return (
          <Text
            key={item.key}
            variant="micro"
            style={{
              position: 'absolute',
              width: 34,
              textAlign: 'center',
              fontWeight: '700',
              color: '#2A2F4F',
              left: c + r * Math.sin(mid) - 17,
              top: c - r * Math.cos(mid) - 8,
            }}
          >
            {`${percent}%`}
          </Text>
        );
      })}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text variant="heading" style={{ fontWeight: '800' }}>
          {centre}
        </Text>
        <Text variant="micro" tone="muted">
          {caption}
        </Text>
      </View>
    </View>
  );
}

export interface MonthBar {
  key: string;
  label: string;
  value: number;
  /** The accessible description, "Sep: ₹112,009.92". */
  description: string;
}

/**
 * Columns with a ₹ axis, a figure above each and the month underneath. The
 * selected month is the deep purple one; tapping another selects it.
 */
export function MonthBars({
  data,
  selected,
  onSelect,
  symbol,
  plotHeight = 150,
}: {
  data: readonly MonthBar[];
  selected: string;
  onSelect: (key: string) => void;
  symbol: string;
  plotHeight?: number;
}) {
  const theme = useTheme();
  const largest = data.reduce((max, bar) => Math.max(max, bar.value), 0);
  const ticks = niceTicks(largest);
  const top = ticks[ticks.length - 1] ?? 1;
  const headroom = 20;
  return (
    <View>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ width: 46, height: plotHeight + headroom }}>
          {ticks.map((tick) => (
            <Text
              key={tick}
              variant="micro"
              tone="muted"
              style={{
                position: 'absolute',
                left: 0,
                top: headroom + plotHeight - (tick / top) * plotHeight - 8,
              }}
            >
              {tick === 0 ? '0' : `${symbol}${compactNumber(tick)}`}
            </Text>
          ))}
        </View>
        <View style={{ flex: 1, height: plotHeight + headroom }}>
          {ticks.map((tick) => (
            <View
              key={tick}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: headroom + plotHeight - (tick / top) * plotHeight,
                height: 1,
                backgroundColor: theme.color.border,
                opacity: 0.6,
              }}
            />
          ))}
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end' }}>
            {data.map((bar) => {
              const active = bar.key === selected;
              const barHeight = Math.max((bar.value / top) * plotHeight, bar.value > 0 ? 4 : 0);
              return (
                <Pressable
                  key={bar.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={bar.description}
                  onPress={() => onSelect(bar.key)}
                  style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end' }}
                >
                  <Text
                    variant="micro"
                    numberOfLines={1}
                    style={{
                      marginBottom: 3,
                      fontWeight: active ? '800' : '500',
                      color: active ? theme.color.brandPressed : theme.color.textMuted,
                    }}
                  >
                    {bar.value > 0 && (data.length <= 6 || active)
                      ? `${symbol}${compactNumber(bar.value)}`
                      : ''}
                  </Text>
                  <View
                    style={{
                      width: '62%',
                      maxWidth: 36,
                      height: barHeight,
                      borderTopLeftRadius: 8,
                      borderTopRightRadius: 8,
                      backgroundColor: active ? theme.color.brandPressed : theme.color.brand,
                      opacity: active ? 1 : 0.35,
                    }}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
      <View style={{ flexDirection: 'row', marginStart: 46, marginTop: theme.spacing.xs }}>
        {data.map((bar) => (
          <Text
            key={bar.key}
            variant="micro"
            tone={bar.key === selected ? undefined : 'muted'}
            align="center"
            style={{ flex: 1, fontWeight: bar.key === selected ? '700' : '400' }}
          >
            {bar.label}
          </Text>
        ))}
      </View>
    </View>
  );
}
