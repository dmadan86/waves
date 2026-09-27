/**
 * The month card under the hero: what you spent this month, what you are owed
 * and what you owe, side by side in three columns — the three figures the old
 * balance deck made you swipe between, now read in one glance.
 *
 * The spend carries a change against last month when there is a last month to
 * compare with; the two balances are standings, not flows, so they carry none.
 * "See insights" opens the spending screen.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { directionalIcon, iconSize, MoneyText, Row, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';

import { percentChange } from '@/lib/homeDashboard';

import { BALANCE_MASK } from './HomeBalanceCard';

export function HomeMonthCard({
  spent,
  lastSpent,
  owed,
  owing,
  currency,
  locale,
  hidden,
  onInsights,
}: {
  spent: bigint;
  lastSpent: bigint;
  owed: bigint;
  owing: bigint;
  currency: string;
  locale: string;
  hidden: boolean;
  onInsights: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const change = percentChange(spent, lastSpent);

  const columns = [
    {
      key: 'spent',
      label: t.homeDash.youSpent,
      amount: spent,
      icon: 'arrow-up' as const,
      tint: theme.tint.mint,
      change,
    },
    {
      key: 'owed',
      label: t.homeDash.youAreOwed,
      amount: owed,
      icon: 'arrow-down' as const,
      tint: theme.tint.sky,
      change: null,
    },
    {
      key: 'owe',
      label: t.homeDash.youOwe,
      amount: owing,
      icon: 'arrow-up' as const,
      tint: theme.tint.pink,
      change: null,
    },
  ];

  return (
    <View
      style={{
        backgroundColor: theme.color.surface,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.color.border,
        paddingVertical: theme.spacing.lg,
        paddingHorizontal: theme.spacing.md,
        gap: theme.spacing.md,
      }}
    >
      <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="subheading" style={{ paddingStart: theme.spacing.xs }}>
          {t.homeDash.thisMonth}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.homeDash.seeInsights}
          onPress={onInsights}
          hitSlop={8}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 2,
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <Text variant="caption" tone="brand" style={{ fontWeight: '700' }}>
            {t.homeDash.seeInsights}
          </Text>
          <Ionicons
            name={directionalIcon('chevron-forward')}
            size={iconSize.md}
            color={theme.color.brand}
          />
        </Pressable>
      </Row>

      <Row>
        {columns.map((column, index) => (
          <View
            key={column.key}
            accessible
            accessibilityLabel={
              hidden ? column.label : undefined /* MoneyText speaks the figure itself */
            }
            style={{
              flex: 1,
              alignItems: 'center',
              gap: theme.spacing.xs,
              paddingHorizontal: theme.spacing.xs,
              borderStartWidth: index === 0 ? 0 : 1,
              borderStartColor: theme.color.border,
            }}
          >
            <View
              style={{
                width: 30,
                height: 30,
                borderRadius: 15,
                backgroundColor: column.tint.bg,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name={column.icon} size={iconSize.md} color={column.tint.ink} />
            </View>
            <Text variant="caption" tone="muted" align="center" numberOfLines={1}>
              {column.label}
            </Text>
            {hidden ? (
              <Text variant="subheading" style={{ fontWeight: '700' }}>
                {BALANCE_MASK}
              </Text>
            ) : (
              <MoneyText
                amount={column.amount}
                currency={currency as never}
                locale={locale}
                variant="subheading"
                style={{ fontWeight: '700' }}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
              />
            )}
            {column.change !== null ? (
              <View
                style={{
                  paddingHorizontal: theme.spacing.sm,
                  paddingVertical: 2,
                  borderRadius: theme.radius.pill,
                  backgroundColor: column.tint.bg,
                }}
              >
                <Text variant="micro" style={{ color: column.tint.ink, fontWeight: '700' }}>
                  {`${column.change > 0 ? '+' : column.change < 0 ? '−' : ''}${Math.abs(column.change)}%`}
                </Text>
              </View>
            ) : null}
          </View>
        ))}
      </Row>
    </View>
  );
}
