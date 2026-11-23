/**
 * The month cards the Personal home and the household home share: the change
 * pill, the six-month bars and the budget ring.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { iconSize, Row, Text, useTheme } from '@waves/ui';

import { BALANCE_MASK } from '@/components/home/HomeBalanceCard';
import { fill, type useStrings } from '@/i18n';

/** How this month's spend moved against last month's: up is red (more went
 *  out), down is green — a tinted chip on the summary card. */
export function ChangePill({ change }: { change: number }) {
  const theme = useTheme();
  const up = change > 0;
  const down = change < 0;
  const color = up ? theme.color.negative : down ? theme.color.positive : theme.color.textMuted;
  const bg = up
    ? theme.color.negativeSoft
    : down
      ? theme.color.positiveSoft
      : theme.color.surfaceMuted;
  return (
    <Row
      style={{
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 3,
        borderRadius: 6,
        backgroundColor: bg,
      }}
    >
      <Ionicons
        name={up ? 'arrow-up' : down ? 'arrow-down' : 'remove'}
        size={iconSize.xs}
        color={color}
      />
      <Text variant="caption" style={{ color, fontWeight: '700' }}>
        {`${Math.abs(change)}%`}
      </Text>
    </Row>
  );
}

/** How tall the mini bar chart stands. */
const SPEND_CHART_HEIGHT = 56;

/**
 * The bar chart beside the headline: the last several months' spend, each a bar
 * with its month's short name underneath, the latest in solid brand. Drawn with
 * plain `View`s — no library, nothing to animate.
 */
export function SpendHistoryChart({
  values,
  labels,
}: {
  values: readonly bigint[];
  labels: readonly string[];
}) {
  const theme = useTheme();
  if (values.length < 2) return null;
  const max = values.reduce((m, v) => (v > m ? v : m), 0n);
  return (
    <Row
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ alignItems: 'flex-end', gap: theme.spacing.sm }}
    >
      {values.map((value, index) => {
        const ratio = max > 0n ? Number(value) / Number(max) : 0;
        const height = Math.max(4, Math.round(ratio * (SPEND_CHART_HEIGHT - 4)));
        const latest = index === values.length - 1;
        return (
          <View key={index} style={{ alignItems: 'center', gap: 2 }}>
            <View
              style={{
                width: 14,
                height,
                borderRadius: 4,
                backgroundColor: latest ? theme.color.brand : theme.color.brandSoft,
              }}
            />
            <Text variant="micro" tone={latest ? undefined : 'muted'} numberOfLines={1}>
              {labels[index]}
            </Text>
          </View>
        );
      })}
    </Row>
  );
}

/** The month's budget: a ring with the share used, what was spent against the
 *  cap, a bar, and a chip saying what is left (and about how much a day). */
export function BudgetSummary({
  progress,
  perDay,
  hidden,
  fmt,
  t,
  onPress,
}: {
  progress: { spent: bigint; limit: bigint; ratio: number };
  perDay: bigint;
  hidden: boolean;
  fmt: (amount: bigint) => string;
  t: ReturnType<typeof useStrings>['t'];
  onPress: () => void;
}) {
  const theme = useTheme();
  const h = t.personalHome;
  const show = (amount: bigint): string => (hidden ? BALANCE_MASK : fmt(amount));
  const percent = Math.round(progress.ratio * 100);
  const over = progress.spent > progress.limit;
  const gap = over ? progress.spent - progress.limit : progress.limit - progress.spent;
  const ink = over ? theme.color.negative : theme.color.brand;
  const chip = `${fill(over ? h.overChip : h.leftChip, { amount: show(gap) })}${
    !over && perDay > 0n ? ` · ${fill(h.aDay, { amount: show(perDay) })}` : ''
  }`;
  const size = 92;
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t.personal.dash.monthlyBudget}. ${show(progress.spent)} ${fill(t.personal.dash.budgetOf, { limit: show(progress.limit) })}. ${percent}%. ${chip}`}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <Row style={{ alignItems: 'center', gap: theme.spacing.lg }}>
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Svg
            width={size}
            height={size}
            style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}
          >
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={theme.color.brandSoft}
              strokeWidth={stroke}
              fill="none"
            />
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={ink}
              strokeWidth={stroke}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${circumference * Math.min(1, progress.ratio)} ${circumference}`}
            />
          </Svg>
          <Text style={{ fontSize: 20, lineHeight: 24, fontWeight: '800' }}>{`${percent}%`}</Text>
          <Text variant="micro" tone="muted" numberOfLines={1}>
            {fill(t.personal.dash.budgetOf, { limit: show(progress.limit) })}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: theme.spacing.xs }}>
          <Text numberOfLines={1} style={{ fontSize: 18, lineHeight: 23, fontWeight: '700' }}>
            {fill(h.spentAmount, { amount: show(progress.spent) })}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {fill(h.budgetLine, { amount: show(progress.limit) })}
          </Text>
          <View
            style={{
              height: 8,
              borderRadius: 4,
              backgroundColor: theme.color.brandSoft,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                width: `${Math.min(100, percent)}%`,
                height: 8,
                borderRadius: 4,
                backgroundColor: ink,
              }}
            />
          </View>
          <Row
            style={{
              alignSelf: 'flex-start',
              alignItems: 'center',
              gap: theme.spacing.xs,
              borderRadius: theme.radius.pill,
              backgroundColor: over ? theme.color.negativeSoft : theme.color.brandSoft,
              paddingHorizontal: theme.spacing.sm,
              paddingVertical: 3,
            }}
          >
            <Ionicons name="locate-outline" size={iconSize.sm} color={ink} />
            <Text variant="micro" numberOfLines={2} style={{ flexShrink: 1 }}>
              {chip}
            </Text>
          </Row>
        </View>
      </Row>
    </Pressable>
  );
}

/** One of the three month figures: a small colour dot, what it is and the
 *  amount — tappable through to where it comes from. */
export function FlowTile({
  icon,
  tone,
  label,
  value,
  negative = false,
  hidden = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: 'income' | 'negative' | 'brand';
  label: string;
  value: string;
  /** The figure is below zero — drawn in the negative colour. */
  negative?: boolean;
  /** The eye is shut: show the mask in place of the amount. */
  hidden?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const ink =
    tone === 'income'
      ? theme.color.positive
      : tone === 'negative'
        ? theme.color.negative
        : theme.color.brand;
  void icon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hidden ? label : `${label}. ${value}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 0,
        gap: 2,
        paddingVertical: theme.spacing.xs,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Row style={{ alignItems: 'center', gap: 6 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: ink }} />
        <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
          {label}
        </Text>
      </Row>
      <Text
        tabular
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        style={{
          fontSize: 16,
          lineHeight: 21,
          fontWeight: '600',
          color: hidden ? theme.color.text : negative ? theme.color.negative : theme.color.text,
        }}
      >
        {hidden ? BALANCE_MASK : value}
      </Text>
    </Pressable>
  );
}
