/**
 * One side of a balance card's quiet two-column row: a small arrow beside
 * what it is — the figure shape used across the app so it costs a line
 * rather than a disc — then the figure, and what it is counted across.
 *
 * Home's dashboard draws two of these ("You lent" / "You owe", each "Across
 * N groups") either side of a hairline divider; Friends draws the same two
 * ("Owed to you" / "You owe", each "N friends") so the two tabs' cards read
 * as one shape rather than two hand-rolled panels. `extra` is the one thing
 * only Friends uses: a currency can't be summed across (ADR-003/004), so a
 * side holding more than one wears a small muted line under its count
 * naming how many more there are, instead of a separate pill.
 */

import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { iconSize, Row, Skeleton, Text, useTheme } from '@waves/ui';

import { SplitMoney } from '@/components/SplitMoney';

/** What stands in for a figure while the eye is shut. */
const MASK = '••••••';

export function BalanceSide({
  icon,
  color,
  amount,
  label,
  detail,
  extra,
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
  /** A small muted line under `detail` — "+2 more currencies" — for a side
   *  that holds more than the one currency shown. Omitted entirely when
   *  null/undefined, which is every call Home makes (ADR-004: Home's two
   *  sides are always a single currency). */
  extra?: string | null;
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
          {MASK}
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
      {!loading && !hidden && extra ? (
        <Text variant="micro" tone="muted" numberOfLines={1}>
          {extra}
        </Text>
      ) : null}
    </View>
  );
}
