/**
 * A money figure with its minor units drawn lighter — "₹82,185" in full ink,
 * ".00" behind it at part strength — so the whole units are what gets read.
 *
 * Shared by the dashboard's balance card and group rows, the Settle up sheet
 * and the activity feed, so a figure reads the same everywhere it is split. A
 * currency with no minor units (yen) prints whole. The figure is a magnitude:
 * the direction is the caller's colour (and its words), not a sign.
 */

import { format, money } from '@waves/core';
import { Text } from '@waves/ui';

export function SplitMoney({
  amount,
  currency,
  locale,
  color,
  fontSize = 17,
  weight = '700',
}: {
  amount: bigint;
  currency: string;
  locale: string;
  color: string;
  fontSize?: number;
  weight?: '600' | '700' | '800';
}) {
  const text = format(money(amount < 0n ? -amount : amount, currency as never), { locale });
  let decimal = '.';
  try {
    decimal =
      new Intl.NumberFormat(locale).formatToParts(1.5).find((part) => part.type === 'decimal')
        ?.value ?? '.';
  } catch {
    // Keep the dot.
  }
  const cut = text.lastIndexOf(decimal);
  const whole = cut > 0 ? text.slice(0, cut) : text;
  const minor = cut > 0 ? text.slice(cut) : '';
  return (
    <Text
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.6}
      style={{ color, fontSize, lineHeight: Math.round(fontSize * 1.25), fontWeight: weight }}
    >
      {whole}
      {minor ? <Text style={{ color, fontWeight: '500', opacity: 0.55 }}>{minor}</Text> : null}
    </Text>
  );
}
