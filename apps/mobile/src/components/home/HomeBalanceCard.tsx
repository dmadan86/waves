/**
 * The dashboard's balance card: a white card that rides up over the bottom of
 * the hero's wash, carrying where you stand and the two sides that make it up.
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

import { useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';

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
  background,
  band,
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
  /** The time of day's card landscape (`lib/scene`), drawn behind the figures. */
  background?: number;
  /** Its colours, left to right, carried on down under the rest of the card. */
  band?: readonly [string, string];
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const [period, setPeriod] = useState<Period>(Period.Overall);
  // The card's width, measured, so the landscape can be drawn whole across it.
  const [artWidth, setArtWidth] = useState(0);
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
        shadowColor: '#3B2A8C',
        shadowOpacity: 0.12,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 8 },
        elevation: 4,
      }}
    >
      {/* The time of day's landscape under the whole card, the action strip
          included. It fades to white on the left, where the words are, and
          shows its scene on the right — so it is sized to the card's height and
          pinned to the right edge, never centre-cropped: a centred crop of a
          wide picture on a narrower card cut the scene off and left only the
          fade. The shadow lives on the outer view, the clipping on this one. */}
      <View
        onLayout={(event) => setArtWidth(event.nativeEvent.layout.width)}
        style={{ borderRadius: theme.radius.xl, overflow: 'hidden' }}
      >
        {background && band && artWidth > 0 ? (
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { opacity: theme.scheme === 'dark' ? 0.4 : 1 }]}
          >
            {/* The scene's colours carried on down the whole card. */}
            <LinearGradient
              colors={band}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
            {/* The picture across the top, whole, at its own shape. */}
            <Image
              source={background}
              resizeMode="cover"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: artWidth,
                height: artWidth / CARD_ART_RATIO,
              }}
            />
            {/* Its foot faded into the band below, with no line where the
                picture stops: the band drawn over the lower part of the picture
                in thin strips, each a little more solid than the one above —
                a mask's fade, without a masking library. */}
            {FADE_STEPS.map((step) => {
              const artHeight = artWidth / CARD_ART_RATIO;
              const top = artHeight * (FADE_FROM + ((1 - FADE_FROM) * step) / FADE_STEPS.length);
              return (
                <LinearGradient
                  key={step}
                  colors={band}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={{
                    position: 'absolute',
                    left: 0,
                    width: artWidth,
                    top,
                    height: artHeight - top + 1,
                    opacity: FADE_LAYER_OPACITY,
                  }}
                />
              );
            })}
          </View>
        ) : null}
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

/** Where on the picture the fade into the band begins, as a share of its
 *  height, how many strips it is drawn in, and how solid each strip is — the
 *  last strip's stack reaches ~95% band. */
const FADE_FROM = 0.4;
const FADE_STEPS = Array.from({ length: 14 }, (_, index) => index);
const FADE_LAYER_OPACITY = 0.2;

/** The card landscapes' width over height (866 × ~276). */
const CARD_ART_RATIO = 3.14;

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
