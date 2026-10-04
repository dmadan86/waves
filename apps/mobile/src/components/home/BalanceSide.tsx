/**
 * One side of a balance card's quiet two-column row: a small arrow beside
 * what it is — the figure shape used across the app so it costs a line
 * rather than a disc — then the figure, and what it is counted across.
 *
 * Home's dashboard draws two of these ("You lent" / "You owe", each "Across
 * N groups") either side of a hairline divider; Friends draws the same two
 * ("Owed to you" / "You owe", each "N friends") so the two tabs' cards read
 * as one shape rather than two hand-rolled panels. `chips` is the one thing
 * only Friends uses: a currency can't be summed across (ADR-003/004), so a
 * side holding more than one shows the others' real amounts as small chips
 * on one line under its figure, ending in a "+N" chip when they don't all fit.
 */

import { useState } from 'react';
import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { iconSize, Row, Skeleton, Text, useTheme } from '@waves/ui';

import { SplitMoney } from '@/components/SplitMoney';
import { CHIP_METRICS, fitChips } from '@/lib/chipFit';
import { format, money } from '@waves/core';

/** The other currencies a side holds, drawn as small chips under its figure. */
export interface CurrencyChip {
  amount: bigint;
  currency: string;
}

/** What stands in for a figure while the eye is shut. */
const MASK = '••••••';

export function BalanceSide({
  icon,
  color,
  amount,
  label,
  detail,
  chips,
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
  /** The muted caption under the figure; omitted by Friends. */
  detail?: string | null;
  /** The side's other currencies, biggest first. Empty/undefined draws no row
   *  at all, which is every call Home makes (ADR-004: Home's sides are always
   *  a single currency). */
  chips?: readonly CurrencyChip[];
  currency: string;
  locale: string;
  hidden: boolean;
  loading: boolean;
  /** The right-hand side: inset from the divider. */
  trailing?: boolean;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const labels = (chips ?? []).map((chip) =>
    format(money(chip.amount < 0n ? -chip.amount : chip.amount, chip.currency as never), {
      locale,
    }),
  );
  // Until measured, assume the narrowest plausible half-card so first paint
  // never overflows; the real width replaces it a frame later.
  const fit = fitChips(labels, width > 0 ? width : 150);
  const showChips = !loading && !hidden && labels.length > 0;
  return (
    <View
      onLayout={(event) =>
        setWidth(event.nativeEvent.layout.width - (trailing ? theme.spacing.lg : theme.spacing.sm))
      }
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
      {detail ? (
        <Text variant="micro" tone="muted" numberOfLines={1}>
          {detail}
        </Text>
      ) : null}
      {showChips ? (
        <Row style={{ gap: CHIP_METRICS.gap, flexWrap: 'nowrap', overflow: 'hidden' }}>
          {labels.slice(0, fit.shown).map((label, i) => (
            <Chip key={chips![i]!.currency} label={label} color={color} />
          ))}
          {fit.hidden > 0 ? <Chip label={`+${fit.hidden}`} color={color} /> : null}
        </Row>
      ) : null}
    </View>
  );
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <View
      style={{
        paddingHorizontal: CHIP_METRICS.padX,
        paddingVertical: 1,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: color,
      }}
    >
      <Text
        numberOfLines={1}
        style={{ fontSize: CHIP_METRICS.fontSize, lineHeight: 16, fontWeight: '600', color }}
      >
        {label}
      </Text>
    </View>
  );
}
