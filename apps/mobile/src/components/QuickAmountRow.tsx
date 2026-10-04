/**
 * The amount, what it is in, and the fast way to top it up without the keypad.
 *
 * One card: the figure and its currency on one line — the unit on the figure's
 * own line is what every payments app that handles more than one currency
 * does, because "$ 1,300" is a single thing to read and a stacked pair is two
 * — and the quick-add chips underneath.
 *
 * ## Two ways in
 *
 * **Type it.** The keypad opens with the sheet and is still the fastest way to
 * enter a figure nobody could guess.
 *
 * **Tap a chip.** For the last nudge — rounding a bill up, adding the tip you
 * forgot, or building a round figure a tap at a time. The chips are read off
 * the amount (`quickAdds`), so they say +₹5/+₹10/+₹50/+₹100 on a small figure
 * and scale up with it.
 *
 * Neither is load-bearing on its own: the keypad alone does everything, which
 * is what keeps the chips optional rather than something a person has to
 * discover to use the sheet.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { formatMinorInput, type CurrencyCode } from '@waves/core';
import { AmountField, Row, Text, useTheme } from '@waves/ui';

import { flagFor } from '@/components/expense/AmountHeader';
import { useStrings } from '@/i18n';
import { quickAdds } from '@/lib/amountStep';

export function QuickAmountRow({
  currency,
  value,
  onChange,
  onPickCurrency,
}: {
  currency: CurrencyCode;
  value: bigint;
  onChange: (amount: bigint) => void;
  /** Opens the currency shortlist. The pill is the only thing that does. */
  onPickCurrency: () => void;
}) {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  const soft = dark ? theme.color.surfaceMuted : '#F1EEFD';
  const accent = dark ? theme.color.brand : '#6A45E8';
  const { t } = useStrings();
  const flag = flagFor(currency);

  return (
    // One dense card: the figure beside its currency, the jumps under it.
    <View
      style={{
        gap: theme.spacing.sm,
        padding: theme.spacing.sm,
        borderRadius: 16,
        backgroundColor: soft,
      }}
    >
      <Row style={{ alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm }}>
        <View style={{ flex: 1 }}>
          <AmountField
            currency={currency}
            value={value}
            onChange={onChange}
            size="hero"
            align="start"
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.quickExpense.pickCurrency.replace('{currency}', currency)}
          onPress={onPickCurrency}
          hitSlop={8}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            minHeight: 34,
            paddingHorizontal: 10,
            borderRadius: theme.radius.pill,
            backgroundColor: theme.color.surface,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          {flag ? <Text style={{ fontSize: 16 }}>{flag}</Text> : null}
          <Text style={{ fontSize: 13, fontWeight: '600', color: theme.color.text }}>
            {currency}
          </Text>
          <Ionicons name="chevron-down" size={13} color={theme.color.textMuted} />
        </Pressable>
      </Row>

      {/* Bigger jumps than typing, and they move with the figure: +₹5 on a
          chai, +₹500 on a flight, recomputed as it grows. Additive rather
          than absolute because an expense is a number you are topping up —
          the tip, the extra round — not one you are replacing. Four, edge to
          edge, rather than a row with a gap at the end. */}
      <Row style={{ gap: theme.spacing.xs }}>
        {quickAdds(value, currency).map((add) => (
          <Pressable
            key={add.toString()}
            accessibilityRole="button"
            accessibilityLabel={t.quickExpense.stepUp.replace(
              '{amount}',
              formatMinorInput(add, currency),
            )}
            onPress={() => onChange(value + add)}
            hitSlop={6}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 32,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 4,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.color.surface,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            {/* Four chips share a narrow row, and the largest currencies'
                figures (₫1,000,000) are long enough to clip at 1.6× system
                text scaling. Shrinking the glyph keeps the whole amount on
                one line rather than truncating it to something that reads as
                a smaller, wrong figure; the accessibility label above still
                carries the full amount regardless of what fits visually. */}
            <Text
              style={{ fontSize: 13, fontWeight: '600', color: accent }}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              {`+${formatMinorInput(add, currency)}`}
            </Text>
          </Pressable>
        ))}
      </Row>
    </View>
  );
}
