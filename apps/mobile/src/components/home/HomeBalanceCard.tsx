/**
 * The dashboard's balance card: a frosted glass card that rides up over the
 * bottom of the hero's scene, carrying where you stand and the two sides that make it up.
 *
 *   Total you owe
 *   ₹1,13,689.50
 *   ↑ You lent                  |  ↓ You owe
 *   ₹42,350.00                  |  ₹1,56,039.50
 *   Across 4 groups             |  Across 6 groups
 *
 * The quick actions ride along its foot as a strip (`footer`).
 *
 * The eye masks every figure on the dashboard, not just this card's.
 *
 * All in the primary currency — there is no total across currencies (ADR-004).
 */

import type { ReactNode, RefObject } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { iconSize, Row, Skeleton, Text, useTheme } from '@waves/ui';

import { plural, useStrings } from '@/i18n';
import { SplitMoney } from '@/components/SplitMoney';
import { BalanceSide } from '@/components/home/BalanceSide';
import { GlassSurface } from '@/components/home/GlassSurface';

/** What stands in for a figure while the eye is shut — shared with the rows. */
export const BALANCE_MASK = '••••••';

export function HomeBalanceCard({
  net,
  owed,
  owing,
  owedGroups,
  owingGroups,
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
  const label =
    net === 0n ? t.homeDash.totalSettled : net > 0n ? t.homeDash.totalOwed : t.homeDash.totalOwe;
  const figure = net < 0n ? -net : net;

  return (
    <GlassSurface blurTarget={blurTarget} folderTab>
      <Row
        style={{ height: 34, width: '60%', alignItems: 'center', paddingStart: theme.spacing.lg, paddingEnd: 14, gap: 6 }}
      >
        <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
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
            size={iconSize.sm}
            color={theme.color.textMuted}
          />
        </Pressable>
        {settling ? <ActivityIndicator size="small" color={theme.color.brand} /> : null}
      </Row>
      <View
        style={{
          paddingTop: 0,
          paddingBottom: theme.spacing.xs,
          gap: theme.spacing.sm,
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
          </View>
        </Row>

        <Row style={{ alignItems: 'center', paddingHorizontal: theme.spacing.lg }}>
          <BalanceSide
            iconDisc
            uniformDecimals
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
          <BalanceSide
            iconDisc
            uniformDecimals
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
    </GlassSurface>
  );
}

const AMOUNT_STYLE = { fontSize: 30, lineHeight: 36, fontWeight: '800' } as const;
