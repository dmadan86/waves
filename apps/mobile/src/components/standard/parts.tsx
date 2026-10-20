/**
 * The standard building blocks, apart from the header: pills, section headings,
 * cards, the headline stat card and the list row. See docs/design-standard.md.
 */

import type { ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View, type ViewStyle } from 'react-native';

import { Card, directionalIcon, iconSize, Row, Text, useTheme } from '@waves/ui';

import { Sparkline } from '@/components/SpendingCharts';

/** The selected pill's navy. */
export const PILL_SELECTED = '#1F1B4D';

/** The translucent white a pill wears over the photo. */
export function useGlass(): string {
  const theme = useTheme();
  return theme.scheme === 'dark' ? 'rgba(20,20,34,0.72)' : 'rgba(255,255,255,0.82)';
}

/** One white pill that opens something: an optional leading glyph, a label, a chevron. */
export function PillButton({
  label,
  icon,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const glass = useGlass();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={{
        height: 38,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radius.pill,
        backgroundColor: glass,
      }}
    >
      {icon ? <Ionicons name={icon} size={iconSize.base} color={theme.color.text} /> : null}
      <Text variant="caption" style={{ fontWeight: '600' }}>
        {label}
      </Text>
      <Ionicons name="chevron-down" size={iconSize.sm} color={theme.color.text} />
    </Pressable>
  );
}

/** A row of choose-one pills: navy when selected, white when not. */
export function SegmentedPills<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  const glass = useGlass();
  return (
    <>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={{
              height: 38,
              paddingHorizontal: theme.spacing.lg,
              borderRadius: theme.radius.pill,
              justifyContent: 'center',
              backgroundColor: selected ? PILL_SELECTED : glass,
            }}
          >
            <Text
              variant="caption"
              style={{ fontWeight: '600', color: selected ? '#FFFFFF' : theme.color.textMuted }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </>
  );
}

/**
 * A section's title with, optionally, one action on the right. The action is
 * drawn only when it is given — callers pass `undefined` when it would do
 * nothing, so a "See all" never sits there inert.
 */
export function SectionHeader({
  title,
  action,
  trailing,
}: {
  title: string;
  /** A text link with a chevron, "See all ›". */
  action?: { label: string; onPress: () => void } | undefined;
  /** Anything else for the right-hand end, such as a dropdown pill or a day total. */
  trailing?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
      <Text
        variant="heading"
        accessibilityRole="header"
        style={{ fontSize: 20, lineHeight: 26, fontWeight: '800' }}
      >
        {title}
      </Text>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          hitSlop={8}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
        >
          <Text variant="caption" tone="brand" style={{ fontWeight: '600' }}>
            {action.label}
          </Text>
          <Ionicons
            name={directionalIcon('chevron-forward')}
            size={iconSize.sm}
            color={theme.color.brand}
          />
        </Pressable>
      ) : (
        trailing
      )}
    </Row>
  );
}

/** The white rounded card with its soft shadow. */
export function StandardCard({
  children,
  style,
  flush = false,
}: {
  children: ReactNode;
  style?: ViewStyle;
  /** No padding, for a card whose content runs to the edges (the stat card's sparkline). */
  flush?: boolean;
}) {
  const theme = useTheme();
  return (
    <Card
      padded={false}
      style={[
        {
          borderRadius: theme.radius.xl,
          padding: flush ? 0 : theme.spacing.lg,
          overflow: flush ? 'hidden' : 'visible',
        },
        style,
      ]}
    >
      {children}
    </Card>
  );
}

/**
 * The headline figure of a screen: a muted label with its glyph, the amount big
 * with the minor units grey, a line under it, and optionally a delta pill and a
 * sparkline along the foot.
 */
export function StatCard({
  icon = 'wallet-outline',
  label,
  lead,
  fraction,
  accessibilityLabel,
  caption,
  delta,
  trend,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  /** The amount up to the decimal separator, with its symbol. */
  lead: string;
  /** The separator and minor units (and any trailing symbol); drawn grey. */
  fraction: string;
  accessibilityLabel: string;
  /** The line under the amount: "in INR", or a count. */
  caption?: ReactNode;
  /** Change against the last period; omit when there is nothing to compare with. */
  delta?: { percent: number; caption: string };
  /** Figures for the area sparkline; fewer than two draws none. */
  trend?: readonly number[];
}) {
  const theme = useTheme();
  const up = delta ? delta.percent >= 0 : true;
  const deltaColor = up ? '#16A34A' : theme.color.negative;
  const amount = { fontSize: 34, lineHeight: 42, fontWeight: '800' } as const;
  return (
    <StandardCard flush>
      <View style={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.sm }}>
        <Row style={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
              <Ionicons name={icon} size={iconSize.lg} color={theme.color.textMuted} />
              <Text tone="muted" style={{ fontSize: 15, lineHeight: 20 }}>
                {label}
              </Text>
            </Row>
            <Text
              accessibilityLabel={accessibilityLabel}
              numberOfLines={1}
              adjustsFontSizeToFit
              style={{ ...amount, color: theme.color.text, marginTop: theme.spacing.xs }}
            >
              {lead}
              <Text style={{ ...amount, color: theme.color.textFaint }}>{fraction}</Text>
            </Text>
            {caption}
          </View>
          {delta ? (
            <View style={{ alignItems: 'center', gap: 2 }}>
              <Row
                style={{
                  alignItems: 'center',
                  gap: 2,
                  paddingHorizontal: theme.spacing.md,
                  paddingVertical: 4,
                  borderRadius: theme.radius.pill,
                  backgroundColor: up ? 'rgba(34,163,94,0.14)' : theme.color.negativeSoft,
                }}
              >
                <Ionicons
                  name={up ? 'arrow-up' : 'arrow-down'}
                  size={iconSize.sm}
                  color={deltaColor}
                />
                <Text variant="caption" style={{ fontWeight: '700', color: deltaColor }}>
                  {`${Math.abs(delta.percent)}%`}
                </Text>
              </Row>
              <Text variant="micro" tone="muted">
                {delta.caption}
              </Text>
            </View>
          ) : null}
        </Row>
      </View>
      {trend && trend.length > 1 ? (
        <Sparkline values={trend} />
      ) : (
        <View style={{ height: theme.spacing.md }} />
      )}
    </StandardCard>
  );
}

/**
 * One line of a list: a leading glyph (a 28dp tinted circle), a title in
 * regular weight with an optional muted subtitle, the amount semibold on the
 * right, then an optional muted percentage. `footer` sits under the text (a
 * share bar). Pass `onPress` only when the row goes somewhere.
 */
export function ListRow({
  leading,
  title,
  subtitle,
  amount,
  percent,
  footer,
  onPress,
  divider = false,
}: {
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  amount?: string;
  percent?: number;
  footer?: ReactNode;
  onPress?: () => void;
  /** A hairline under the row, for every row but the last of a card. */
  divider?: boolean;
}) {
  const theme = useTheme();
  const body = (
    <Row style={{ alignItems: 'center', gap: theme.spacing.md, paddingVertical: theme.spacing.sm }}>
      {leading}
      <View style={{ flex: 1, gap: 4 }}>
        <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1}>{title}</Text>
            {subtitle ? (
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          {amount ? (
            <Text tabular style={{ fontWeight: '600' }}>
              {amount}
            </Text>
          ) : null}
        </Row>
        {footer}
      </View>
      {percent !== undefined ? (
        <Text variant="caption" tone="muted" style={{ width: 36, textAlign: 'right' }}>
          {`${percent}%`}
        </Text>
      ) : null}
      {onPress && percent === undefined ? (
        <Ionicons
          name={directionalIcon('chevron-forward')}
          size={iconSize.sm}
          color={theme.color.textFaint}
        />
      ) : null}
    </Row>
  );
  return (
    <View>
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={amount ? `${title}, ${amount}` : title}
          onPress={onPress}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          {body}
        </Pressable>
      ) : (
        <View accessible accessibilityLabel={amount ? `${title}, ${amount}` : title}>
          {body}
        </View>
      )}
      {divider ? <View style={{ height: 1, backgroundColor: theme.color.border }} /> : null}
    </View>
  );
}
