/**
 * The amount, what it is in, and the two ways to move it without the keypad.
 *
 * One line: a step down, the figure with its currency beside it, a step up.
 * The currency used to sit under the amount as a second row, which read as two
 * questions — how much, and then in what — when it is one. Putting the unit on
 * the figure's own line is what every payments app that handles more than one
 * currency does, because "$ 1,300" is a single thing to read and a stacked
 * pair is two.
 *
 * ## Three ways in, for three different moments
 *
 * **Type it.** The keypad opens with the sheet and is still the fastest way to
 * enter a figure nobody could guess.
 *
 * **Tap a step.** For the last nudge — rounding a bill up, adding the tip you
 * forgot. The step is read off the amount (`stepFor`), so it is ₹1 on a chai
 * and ₹100 on a flight. A line under the row used to say which, on the
 * grounds that a control doing something different every time you look at it
 * should say so; on the screen it was a third row of small grey text under a
 * sheet that is meant to be one glance, and the figure moving when you press
 * the button says the same thing faster. The spoken labels still name it,
 * where there is no figure to watch.
 *
 * **Hold a step.** Holding repeats it, faster after the first second, because
 * a stepper that only taps is forty taps away from rounding ₹1,300 up to
 * ₹1,500.
 *
 * The figure itself is not a gesture surface. It was: a horizontal drag on it
 * scrubbed the amount a step at a time. It came out because the figure is a
 * text field on a sheet that is itself dragged to dismiss, which put three
 * readings on one finger — place the caret, scrub the number, close the sheet
 * — and the drag was the one nobody was reaching for. Nothing is lost: the
 * hold covers the long distances it was for.
 *
 * Neither of the remaining two is load-bearing: the keypad alone does
 * everything, which is what keeps the hold optional rather than something a
 * person has to discover to use the sheet.
 */
import { useEffect, useRef } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { formatMinorInput, type CurrencyCode } from '@waves/core';
import { AmountField, iconSize, Row, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { nudge, quickAdds, stepFor } from '@/lib/amountStep';

/** How long a hold waits before it starts repeating, and how fast it then goes.
    The first beat is slow enough that a normal tap is never read as a hold. */
const HOLD_DELAY_MS = 400;
const REPEAT_MS = 90;
/**
 * How a hold accelerates: one step a beat, then five, then ten.
 *
 * A hold that never speeds up is a slow tap, and one that goes straight to ten
 * overshoots before the eye has read the first figure. Three gears, each about
 * a second long, is enough to cross ₹1,300 to ₹5,000 without the finger
 * waiting and without the number becoming a blur.
 */
const GEARS = [
  { after: 0, times: 1n },
  { after: 10, times: 5n },
  { after: 22, times: 10n },
] as const;

function gearFor(beats: number): bigint {
  let times = 1n;
  for (const gear of GEARS) if (beats >= gear.after) times = gear.times;
  return times;
}

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
  const { t } = useStrings();

  // The live amount, for the repeating hold. The interval is started inside a
  // press handler and keeps the closures it was started with, so reading the
  // value through a ref is what stops each beat from working off the figure as
  // it was when the finger landed.
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);

  // The hold. A timer rather than a gesture library: it is one button repeating
  // itself, and it has to stop on every way a press can end.
  const repeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const delay = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopRepeating = (): void => {
    if (repeat.current) clearInterval(repeat.current);
    if (delay.current) clearTimeout(delay.current);
    repeat.current = null;
    delay.current = null;
  };

  // A held button whose screen goes away mid-hold would otherwise keep firing
  // into a component nobody is looking at.
  useEffect(() => stopRepeating, []);

  const startRepeating = (direction: 1 | -1): void => {
    stopRepeating();
    delay.current = setTimeout(() => {
      let beats = 0;
      repeat.current = setInterval(() => {
        beats += 1;
        const times = gearFor(beats);
        let next = latest.current;
        for (let i = 0n; i < times; i += 1n) next = nudge(next, direction, currency);
        onChange(next);
      }, REPEAT_MS);
    }, HOLD_DELAY_MS);
  };

  const step = stepFor(value, currency);
  const stepLabel = formatMinorInput(step, currency);

  const stepper = (direction: 1 | -1) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        direction === 1
          ? t.quickExpense.stepUp.replace('{amount}', stepLabel)
          : t.quickExpense.stepDown.replace('{amount}', stepLabel)
      }
      accessibilityState={{ disabled: direction === -1 && value === 0n }}
      disabled={direction === -1 && value === 0n}
      onPress={() => onChange(nudge(value, direction, currency))}
      onPressIn={() => startRepeating(direction)}
      onPressOut={stopRepeating}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.color.surfaceMuted,
        opacity: direction === -1 && value === 0n ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <Ionicons
        name={direction === 1 ? 'add' : 'remove'}
        size={iconSize.md}
        color={theme.color.text}
      />
    </Pressable>
  );

  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
        {stepper(-1)}

        {/* The figure and its unit, on one line and centred between the steps. */}
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
            <AmountField currency={currency} value={value} onChange={onChange} size="hero" />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.quickExpense.pickCurrency.replace('{currency}', currency)}
              onPress={onPickCurrency}
              hitSlop={8}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 2,
                minHeight: 32,
                paddingHorizontal: theme.spacing.sm,
                borderRadius: theme.radius.pill,
                backgroundColor: theme.color.surfaceMuted,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text variant="caption" tone="muted">
                {currency}
              </Text>
              <Ionicons name="chevron-down" size={iconSize.sm} color={theme.color.textMuted} />
            </Pressable>
          </Row>
        </View>

        {stepper(1)}
      </Row>

      {/* Bigger jumps than a single step, and they move with the figure: +₹5
          on a chai, +₹500 on a flight, recomputed as it grows. Additive rather
          than absolute because an expense is a number you are topping up —
          the tip, the extra round — not one you are replacing. */}
      <Row style={{ justifyContent: 'center', gap: theme.spacing.sm }}>
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
              minHeight: 32,
              justifyContent: 'center',
              paddingHorizontal: theme.spacing.md,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.color.surfaceMuted,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text variant="caption" tone="muted">
              {`+${formatMinorInput(add, currency)}`}
            </Text>
          </Pressable>
        ))}
      </Row>
    </View>
  );
}
