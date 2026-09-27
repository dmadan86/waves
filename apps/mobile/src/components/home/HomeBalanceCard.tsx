/**
 * The dashboard's balance card: a frosted glass card that rides up over the
 * bottom of the hero's scene, carrying where you stand and the two sides that make it up.
 *
 *   Total you owe                    [Overall ▾]
 *   ₹1,13,689.50
 *   ↑ You lent                  |  ↓ You owe
 *   ₹42,350.00                  |  ₹1,56,039.50
 *   Across 4 groups             |  Across 6 groups
 *
 * The quick actions ride along its foot as a strip (`footer`).
 *
 * The pill switches the headline between the overall standing and this
 * month's spend (with its change against last month); the two sides below are
 * standings either way, so they stay put.
 * The eye masks every figure on the dashboard, not just this card's.
 *
 * All in the primary currency — there is no total across currencies (ADR-004).
 */

import { useState, type ReactNode, type RefObject } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { iconSize, Row, Skeleton, Text, useTheme } from '@waves/ui';

import { plural, useStrings } from '@/i18n';
import { SplitMoney } from '@/components/SplitMoney';
import { percentChange } from '@/lib/homeDashboard';

/** What stands in for a figure while the eye is shut — shared with the rows. */
export const BALANCE_MASK = '••••••';

enum Period {
  Overall = 'overall',
  Month = 'month',
}

export function HomeBalanceCard({
  net,
  owed,
  owing,
  owedGroups,
  owingGroups,
  monthSpent,
  lastMonthSpent,
  currency,
  locale,
  hidden,
  onToggleHide,
  settling,
  loading,
  footer,
  blurTarget,
}: {
  net: bigint;
  /** Everything owed to you, and everything you owe, before the net. */
  owed: bigint;
  owing: bigint;
  /** How many groups each side comes from. */
  owedGroups: number;
  owingGroups: number;
  monthSpent: bigint;
  lastMonthSpent: bigint;
  currency: string;
  locale: string;
  hidden: boolean;
  onToggleHide: () => void;
  /** The figure is the local one and this session's first sync has not landed. */
  settling: boolean;
  /** Nothing to show yet: bars stand in for the figures. */
  loading: boolean;
  /** Drawn along the card's foot, edge to edge — the quick actions. */
  footer?: ReactNode;
  /** What the glass blurs on Android — the hero's scene, wrapped in a
   *  `BlurTargetView`. iOS blurs whatever is behind it without being told. */
  blurTarget?: RefObject<View | null>;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const [period, setPeriod] = useState<Period>(Period.Overall);
  const dark = theme.scheme === 'dark';
  const month = period === Period.Month;

  const label = month
    ? t.homeDash.spentThisMonth
    : net === 0n
      ? t.homeDash.totalSettled
      : net > 0n
        ? t.homeDash.totalOwed
        : t.homeDash.totalOwe;
  const figure = month ? monthSpent : net < 0n ? -net : net;
  const change = month ? percentChange(monthSpent, lastMonthSpent) : null;

  return (
    <View
      style={{
        borderRadius: theme.radius.xl,
        shadowColor: '#322864',
        shadowOpacity: 0.12,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 12 },
      }}
    >
      {/* Frosted glass: the scene behind shows through as atmosphere, blurred
          and mostly washed out, so it never competes with the figures. The
          shadow lives on the outer view, the clipping on this one. */}
      <View
        style={{
          borderRadius: theme.radius.xl,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: dark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.65)',
        }}
      >
        <BlurView
          intensity={GLASS_BLUR}
          tint={dark ? 'dark' : 'light'}
          // Android draws a real blur only when asked; without it the card is
          // simply translucent, which the fill below already keeps readable.
          experimentalBlurMethod="dimezisBlurView"
          blurTarget={blurTarget}
          style={StyleSheet.absoluteFill}
        />
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: dark ? 'rgba(28, 26, 44, 0.82)' : 'rgba(255, 255, 255, 0.82)' },
          ]}
        />
        <View
          style={{
            paddingTop: theme.spacing.md,
            paddingBottom: theme.spacing.md,
            gap: theme.spacing.md,
          }}
        >
          <Row
            style={{
              alignItems: 'flex-start',
              gap: theme.spacing.sm,
              paddingHorizontal: theme.spacing.lg,
            }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
                <Text variant="body" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {label}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={hidden ? t.dashHero.showBalance : t.dashHero.hideBalance}
                  onPress={onToggleHide}
                  hitSlop={10}
                  style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                >
                  <Ionicons
                    name={hidden ? 'eye-off-outline' : 'eye-outline'}
                    size={iconSize.md}
                    color={theme.color.textMuted}
                  />
                </Pressable>
                {settling ? <ActivityIndicator size="small" color={theme.color.brand} /> : null}
              </Row>
              {loading ? (
                <Skeleton width={180} height={32} radius={10} />
              ) : hidden ? (
                <Text style={AMOUNT_STYLE} numberOfLines={1}>
                  {BALANCE_MASK}
                </Text>
              ) : (
                <SplitMoney
                  amount={figure}
                  currency={currency}
                  locale={locale}
                  color={theme.color.text}
                  fontSize={AMOUNT_STYLE.fontSize}
                  weight="800"
                />
              )}
              {change !== null && !hidden ? (
                <Text variant="caption" tone="muted">
                  <Text
                    variant="caption"
                    style={{
                      fontWeight: '700',
                      color: change > 0 ? theme.color.negative : theme.color.positive,
                    }}
                  >
                    {`${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(change)}% `}
                  </Text>
                  {t.homeDash.vsLastMonth}
                </Text>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={month ? t.homeDash.periodMonth : t.homeDash.periodOverall}
              onPress={() => setPeriod(month ? Period.Overall : Period.Month)}
              hitSlop={6}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.sm,
                borderRadius: theme.radius.pill,
                borderWidth: 1,
                borderColor: theme.color.border,
                backgroundColor: theme.color.surface,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text variant="caption" style={{ fontWeight: '600' }}>
                {month ? t.homeDash.periodMonth : t.homeDash.periodOverall}
              </Text>
              <Ionicons name="chevron-down" size={iconSize.sm} color={theme.color.textMuted} />
            </Pressable>
          </Row>

          <Row style={{ alignItems: 'center', paddingHorizontal: theme.spacing.lg }}>
            <Side
              icon="arrow-up"
              color={theme.color.positive}
              amount={owed}
              label={t.homeDash.youLent}
              detail={plural(locale, owedGroups, t.homeDash.acrossGroups)}
              currency={currency}
              locale={locale}
              hidden={hidden}
              loading={loading}
            />
            <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: theme.color.border }} />
            <Side
              icon="arrow-down"
              color={theme.color.negative}
              amount={owing}
              label={t.homeDash.youOwe}
              detail={plural(locale, owingGroups, t.homeDash.acrossGroups)}
              currency={currency}
              locale={locale}
              hidden={hidden}
              loading={loading}
              trailing
            />
          </Row>
        </View>
        {footer ?? null}
      </View>
    </View>
  );
}

/** How hard the glass blurs what is behind it. */
const GLASS_BLUR = 40;

const AMOUNT_STYLE = { fontSize: 30, lineHeight: 36, fontWeight: '800' } as const;

/** One side of the balance: a small arrow beside what it is — the Me tab's
 *  figure shape, so it costs a line rather than a disc — then the figure and how
 *  many groups it comes from. */
function Side({
  icon,
  color,
  amount,
  label,
  detail,
  currency,
  locale,
  hidden,
  loading,
  trailing = false,
}: {
  icon: 'arrow-up' | 'arrow-down';
  color: string;
  amount: bigint;
  label: string;
  detail: string;
  currency: string;
  locale: string;
  hidden: boolean;
  loading: boolean;
  /** The right-hand side: inset from the divider. */
  trailing?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        gap: 2,
        paddingStart: trailing ? theme.spacing.lg : 0,
        paddingEnd: trailing ? 0 : theme.spacing.sm,
      }}
    >
      <Row style={{ alignItems: 'center', gap: 4 }}>
        <Ionicons name={icon} size={iconSize.xs} color={color} />
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {label}
        </Text>
      </Row>
      {loading ? (
        <Skeleton width={80} height={18} radius={6} />
      ) : hidden ? (
        <Text variant="subheading" style={{ fontWeight: '700' }}>
          {BALANCE_MASK}
        </Text>
      ) : (
        <SplitMoney
          amount={amount}
          currency={currency}
          locale={locale}
          color={theme.color.text}
          fontSize={18}
        />
      )}
      <Text variant="micro" tone="muted" numberOfLines={1}>
        {detail}
      </Text>
    </View>
  );
}
