/**
 * The standard building blocks, apart from the header: pills, section headings,
 * cards, the headline stat card and the list row. See docs/design-standard.md.
 */

import type { ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  Pressable,
  View,
  type AccessibilityRole,
  type AccessibilityState,
  type ViewStyle,
} from 'react-native';

import { Card, directionalIcon, iconSize, Row, Text, useSingleAction, useTheme } from '@waves/ui';

import { Sparkline } from '@/components/SpendingCharts';

/** The selected segment's ink. */
export const PILL_SELECTED = '#1F1B4D';

/** The fill of an unselected control on the page: the plain surface. */
export function useGlass(): string {
  return useTheme().color.surface;
}

/** A small outlined button that opens something: an optional leading glyph, a label, a chevron. */
export function PillButton({
  label,
  icon,
  onPress,
  accessibilityLabel,
  chevron = true,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  accessibilityLabel?: string;
  /** The down chevron that says "opens a list"; off for a pill that does something else. */
  chevron?: boolean;
}) {
  const theme = useTheme();
  const glass = useGlass();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={{
        height: 34,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radius.sm,
        borderWidth: 1,
        borderColor: theme.color.border,
        backgroundColor: glass,
      }}
    >
      {icon ? <Ionicons name={icon} size={iconSize.sm} color={theme.color.textMuted} /> : null}
      <Text variant="caption" style={{ fontWeight: '600' }}>
        {label}
      </Text>
      {chevron ? (
        <Ionicons name="chevron-down" size={iconSize.xs} color={theme.color.textMuted} />
      ) : null}
    </Pressable>
  );
}

/** Choose one of a few: a single grey track, the chosen segment drawn on the surface in full ink. */
export function SegmentedPills<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string; icon?: keyof typeof Ionicons.glyphMap }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  const track = theme.scheme === 'dark' ? theme.color.surfaceMuted : '#E8E8ED';
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        padding: 2,
        borderRadius: theme.radius.sm + 2,
        backgroundColor: track,
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={{
              minHeight: 32,
              paddingHorizontal: theme.spacing.md,
              borderRadius: theme.radius.sm,
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.xs,
              justifyContent: 'center',
              backgroundColor: selected ? theme.color.surface : 'transparent',
            }}
          >
            {option.icon ? (
              <Ionicons
                name={option.icon}
                size={iconSize.sm}
                color={selected ? theme.color.text : theme.color.textMuted}
              />
            ) : null}
            <Text
              variant="caption"
              style={{
                fontWeight: selected ? '700' : '500',
                color: selected ? theme.color.text : theme.color.textMuted,
              }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
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
        style={{ fontSize: 17, lineHeight: 22, fontWeight: '700' }}
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

/**
 * The label of a group of fields inside a card (Group name, Add friends,
 * Group type, More options): a muted 18dp glyph, then the title at 15sp bold
 * in full ink. No disc: the glyph is a signpost, not a decoration.
 */
export function SectionLabel({
  icon,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
      <Ionicons name={icon} size={iconSize.md} color={theme.color.textMuted} />
      <Text
        accessibilityRole="header"
        style={{ flexShrink: 1, fontSize: 15, lineHeight: 20, fontWeight: '700' }}
      >
        {children}
      </Text>
    </Row>
  );
}

/** A grouped surface: flat, 12pt corners, a hairline edge instead of a shadow. */
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
          borderRadius: theme.radius.lg,
          borderWidth: theme.scheme === 'dark' ? 0 : 1,
          borderColor: theme.color.border,
          padding: flush ? 0 : theme.spacing.md + 2,
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
 * The headline figure of a screen, set straight on the page (no card): a muted
 * label, the amount large with the minor units grey, a line under it, the
 * change as plain text on the right, and optionally a sparkline along the foot.
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
  const amount = { fontSize: 30, lineHeight: 36, fontWeight: '700' } as const;
  return (
    <View>
      <Row
        style={{ alignItems: 'flex-end', justifyContent: 'space-between', gap: theme.spacing.md }}
      >
        <View style={{ flex: 1 }}>
          <Row style={{ alignItems: 'center', gap: 6 }}>
            <Ionicons name={icon} size={iconSize.sm} color={theme.color.textMuted} />
            <Text variant="caption" tone="muted">
              {label}
            </Text>
          </Row>
          <Text
            accessibilityLabel={accessibilityLabel}
            numberOfLines={1}
            adjustsFontSizeToFit
            tabular
            style={{ ...amount, color: theme.color.text, marginTop: 2 }}
          >
            {lead}
            <Text style={{ ...amount, color: theme.color.textFaint }}>{fraction}</Text>
          </Text>
          {caption}
        </View>
        {delta ? (
          <View style={{ alignItems: 'flex-end', paddingBottom: 4 }}>
            <Text
              variant="caption"
              tabular
              style={{ fontWeight: '700', color: up ? theme.color.text : theme.color.negative }}
            >
              {`${up ? '↑' : '↓'} ${Math.abs(delta.percent)}%`}
            </Text>
            <Text variant="micro" tone="muted">
              {delta.caption}
            </Text>
          </View>
        ) : null}
      </Row>
      {trend && trend.length > 1 ? (
        <View style={{ marginTop: theme.spacing.sm }}>
          <Sparkline values={trend} height={48} />
        </View>
      ) : null}
    </View>
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
  trailing,
  subtitleLines = 1,
  subtitleNegative = false,
  destructive = false,
  highlight,
  titleAccessory,
  titleLines = 1,
  compact = false,
  repeatable = true,
  accessibilityRole = 'button',
  accessibilityState,
}: {
  /** Compact single-line choices keep a 44dp touch target. */
  compact?: boolean;
  /** Allow longer setting labels to wrap beside their control. */
  titleLines?: number;
  /** Selection controls answer every tap; existing rows remain repeatable. */
  repeatable?: boolean;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  amount?: string;
  percent?: number;
  footer?: ReactNode;
  onPress?: () => void;
  /** A hairline under the row, for every row but the last of a card. */
  divider?: boolean;
  /** A control at the right-hand end (a toggle, a pill, a menu button), in place of the chevron. */
  trailing?: ReactNode;
  /** How many lines the subtitle may take before it is cut; one by default. */
  subtitleLines?: number;
  /** Draw the subtitle in the negative colour (an overdue date). */
  subtitleNegative?: boolean;
  /** The title is drawn in the negative colour, for the act that cannot be undone. */
  destructive?: boolean;
  /** A tint behind the whole row, for "this one is you". */
  highlight?: string;
  /** Sits beside the title, such as an ⓘ. */
  titleAccessory?: ReactNode;
}) {
  const theme = useTheme();
  const press = useSingleAction(onPress, { repeatable });
  const spoken = [title, subtitle, amount, percent !== undefined ? `${percent}%` : null]
    .filter(Boolean)
    .join(', ');
  const rowStyle = {
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: compact ? 0 : theme.spacing.sm,
    ...(compact ? { minHeight: 44 } : null),
    ...(highlight
      ? {
          backgroundColor: highlight,
          borderRadius: theme.radius.lg,
          paddingHorizontal: theme.spacing.md,
        }
      : null),
  } as const;
  const main = (
    <>
      {leading}
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
              <Text
                numberOfLines={titleLines}
                // Shrinks before it can reach the accessory or the control beside the row.
                style={[
                  { flexShrink: 1 },
                  destructive ? { color: theme.color.negative, fontWeight: '600' } : null,
                ]}
              >
                {title}
              </Text>
              {titleAccessory}
            </Row>
            {subtitle ? (
              <Text
                variant="caption"
                tone="muted"
                numberOfLines={subtitleLines}
                style={subtitleNegative ? { color: theme.color.negative } : undefined}
              >
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
      {onPress && percent === undefined && !trailing ? (
        <Ionicons
          name={directionalIcon('chevron-forward')}
          size={iconSize.sm}
          color={theme.color.textFaint}
        />
      ) : null}
    </>
  );
  // With a control of its own at the end (a toggle, a menu button) the text and
  // the control are siblings, so a screen reader can reach both; the whole row
  // is not one big accessible button swallowing it.
  const body =
    onPress && (accessibilityRole === 'radio' || accessibilityRole === 'checkbox') ? (
      <Pressable
        accessibilityRole={accessibilityRole}
        accessibilityState={accessibilityState}
        accessibilityLabel={spoken}
        onPress={press}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <Row style={rowStyle}>
          {main}
          {trailing}
        </Row>
      </Pressable>
    ) : trailing ? (
      <Row style={rowStyle}>
        {onPress ? (
          <Pressable
            accessibilityRole={accessibilityRole}
            accessibilityState={accessibilityState}
            accessibilityLabel={spoken}
            onPress={press}
            style={({ pressed }) => ({
              flex: 1,
              ...(compact ? { minHeight: 44 } : null),
              minWidth: 0,
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.md,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            {main}
          </Pressable>
        ) : (
          // Not one accessible group: the ⓘ button and the explanation under the
          // title must be reachable on their own, so the texts are read as they are
          // and the control beside them carries its own label.
          <View
            style={{
              flex: 1,
              minWidth: 0,
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.md,
            }}
          >
            {main}
          </View>
        )}
        {trailing}
      </Row>
    ) : onPress ? (
      <Pressable
        accessibilityRole={accessibilityRole}
        accessibilityState={accessibilityState}
        accessibilityLabel={spoken}
        onPress={press}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <Row style={rowStyle}>{main}</Row>
      </Pressable>
    ) : (
      <View accessible accessibilityLabel={spoken}>
        <Row style={rowStyle}>{main}</Row>
      </View>
    );
  return (
    <View>
      {body}
      {divider ? <View style={{ height: 1, backgroundColor: theme.color.border }} /> : null}
    </View>
  );
}
