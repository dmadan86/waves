/**
 * The dashboard's balance card: a white card that rides up over the bottom of
 * the hero's wash, carrying where you stand and the two sides that make it up.
 *
 *   Total you owe                    [Overall ▾] (chart)
 *   ₹1,13,689.50
 *   ↑ You lent                  |  ↓ You owe
 *   ₹42,350.00                  |  ₹1,56,039.50
 *   Across 4 groups             |  Across 6 groups
 *
 * The quick actions ride along its foot as a strip (`footer`).
 *
 * The pill switches the headline between the overall standing and this
 * month's spend (with its change against last month); the two sides below are
 * standings either way, so they stay put. The chart disc opens the reports.
 * The eye masks every figure on the dashboard, not just this card's.
 *
 * All in the primary currency — there is no total across currencies (ADR-004).
 */

import { useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { iconSize, MoneyText, Row, Skeleton, Text, useTheme } from '@waves/ui';

import { plural, useStrings } from '@/i18n';
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
  onReports,
  footer,
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
  onReports: () => void;
  /** Drawn along the card's foot, edge to edge — the quick actions. */
  footer?: ReactNode;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const [period, setPeriod] = useState<Period>(Period.Overall);
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
        backgroundColor: theme.color.surface,
        borderRadius: theme.radius.xl,
        paddingTop: theme.spacing.md,
        gap: theme.spacing.md,
        shadowColor: '#3B2A8C',
        shadowOpacity: 0.12,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 8 },
        elevation: 4,
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
            <MoneyText
              amount={figure}
              currency={currency as never}
              locale={locale}
              style={AMOUNT_STYLE}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
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
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text variant="caption" style={{ fontWeight: '600' }}>
            {month ? t.homeDash.periodMonth : t.homeDash.periodOverall}
          </Text>
          <Ionicons name="chevron-down" size={iconSize.sm} color={theme.color.textMuted} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.homeDash.reports}
          onPress={onReports}
          hitSlop={6}
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.brandSoft,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Ionicons name="stats-chart" size={iconSize.md} color={theme.color.brand} />
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
      {footer ?? <View style={{ height: theme.spacing.xs }} />}
    </View>
  );
}

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
        <MoneyText
          amount={amount}
          currency={currency as never}
          locale={locale}
          variant="subheading"
          style={{ fontWeight: '700' }}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
        />
      )}
      <Text variant="micro" tone="muted" numberOfLines={1}>
        {detail}
      </Text>
    </View>
  );
}
