/**
 * The dashboard's headline, set on the page (no card), like `StatCard`:
 *
 *   Total you are owed  👁
 *   ₹42,350.00
 *   You lent ₹42,350.00      You owe ₹0.00
 *
 * The two sides are one compact line in the money colours, not icon discs.
 * The eye masks every figure on the dashboard, not just these. All in the
 * primary currency — there is no total across currencies (ADR-004).
 */

import type { ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { format, money } from '@waves/core';
import { iconSize, Row, Skeleton, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { SplitMoney } from '@/components/SplitMoney';

/** What stands in for a figure while the eye is shut — shared with the rows. */
export const BALANCE_MASK = '••••••';

export function HomeBalanceCard({
  net,
  owed,
  owing,
  currency,
  locale,
  hidden,
  onToggleHide,
  settling,
  loading,
  footer,
  catchUp,
}: {
  net: bigint;
  /** Everything owed to you, and everything you owe, before the net. */
  owed: bigint;
  owing: bigint;
  currency: string;
  locale: string;
  hidden: boolean;
  onToggleHide: () => void;
  /** The figure is the local one and this session's first sync has not landed. */
  settling: boolean;
  /** Nothing to show yet: bars stand in for the figures. */
  loading: boolean;
  /** Drawn under the figures — the quick actions. */
  footer?: ReactNode;
  /** First sync still handing over groups: say so instead of claiming a balance. */
  catchUp?: { total: number; loaded: number } | null;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const label = catchUp
    ? t.homeDash.downloadingGroups
        .replace('{loaded}', String(catchUp.loaded))
        .replace('{total}', String(catchUp.total))
    : net === 0n
      ? t.homeDash.totalSettled
      : net > 0n
        ? t.homeDash.totalOwed
        : t.homeDash.totalOwe;
  const figure = net < 0n ? -net : net;
  const side = (caption: string, amount: bigint, color: string) => (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {caption}
      </Text>
      {loading || catchUp ? (
        <Skeleton width={80} height={18} radius={6} />
      ) : (
        <Text
          tabular
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
          style={{ color: hidden ? theme.color.textMuted : color, fontWeight: '600', fontSize: 16 }}
        >
          {hidden ? BALANCE_MASK : format(money(amount, currency as never), { locale })}
        </Text>
      )}
    </View>
  );

  return (
    <View style={{ gap: theme.spacing.md }}>
      <View>
        <Row style={{ alignItems: 'center', gap: 6 }}>
          <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
            {label}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hidden ? t.dashHero.showBalance : t.dashHero.hideBalance}
            onPress={onToggleHide}
            hitSlop={12}
            style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
          >
            <Ionicons
              name={hidden ? 'eye-off-outline' : 'eye-outline'}
              size={iconSize.sm}
              color={theme.color.textMuted}
            />
          </Pressable>
          {settling || catchUp ? <ActivityIndicator size="small" color={theme.color.brand} /> : null}
        </Row>
        {loading || catchUp ? (
          <Skeleton width={180} height={32} radius={8} />
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
            weight="700"
          />
        )}
      </View>
      <Row style={{ gap: theme.spacing.lg }}>
        {side(t.homeDash.youLent, owed, theme.color.positive)}
        {side(t.homeDash.youOwe, owing, theme.color.negative)}
      </Row>
      {footer ?? null}
    </View>
  );
}

const AMOUNT_STYLE = { fontSize: 30, lineHeight: 36, fontWeight: '700' } as const;
