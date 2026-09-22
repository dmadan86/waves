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
 * and ₹100 on a flight, and the button says which, because a control that does
 * something different every time you look at it has to tell you what it is
 * about to do.
 *
 * **Hold, or drag.** Holding a step repeats it, faster after the first second;
 * dragging the figure sideways scrubs it a step at a time. Both exist because
 * a stepper that only taps is forty taps away from rounding ₹1,300 up to
 * ₹1,500, and the keypad is the wrong tool for a change you are feeling your
 * way towards rather than one you already know.
 *
 * None of the three is load-bearing on its own: the keypad alone does
 * everything, which is what keeps the gestures optional rather than something
 * a person has to discover to use the sheet.
 */
import { useEffect, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PanResponder, Pressable, View, type GestureResponderHandlers } from 'react-native';

import { formatMinorInput, type CurrencyCode } from '@waves/core';
import { AmountField, iconSize, Row, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';
import { nudge, scrub, stepFor } from '@/lib/amountStep';

/** How long a hold waits before it starts repeating, and how fast it then goes.
    The first beat is slow enough that a normal tap is never read as a hold. */
const HOLD_DELAY_MS = 400;
const REPEAT_MS = 90;
/** After this many repeats the step is applied several times per beat, so a
    long hold crosses a large distance without the finger waiting on it. */
const ACCELERATE_AFTER = 12;

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

  // The live amount, for the gesture handlers. A `PanResponder` is built once
  // and keeps the closures it was built with, so reading the value through a
  // ref is what stops a drag from starting over at whatever the amount was when
  // the sheet opened.
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);

  // Where the current drag began. Null between drags. The scrub is reckoned
  // from this rather than accumulated, so a finger that goes out and comes back
  // lands exactly where it started.
  const dragStart = useRef<bigint | null>(null);
  const [dragging, setDragging] = useState(false);

  // The responder below is built once, so it would otherwise keep the props it
  // closed over on the first render. These keep it pointed at the current ones.
  const onChangeRef = useRef(onChange);
  const currencyRef = useRef(currency);
  useEffect(() => {
    onChangeRef.current = onChange;
    currencyRef.current = currency;
  }, [onChange, currency]);

  // The drag, built in an effect rather than in render.
  //
  // `packages/ui` builds its sheet-drag responder straight into a ref, which is
  // fine there — this app additionally runs the React Compiler's lint, and it
  // is right to object: a responder created in render reads `.current` out of
  // refs that render has no business touching. Built here instead, the
  // handlers land a frame after the first paint (nothing to drag before then
  // anyway) and the callbacks may read the refs above freely, because by the
  // time any of them fires, render is long over.
  const [handlers, setHandlers] = useState<GestureResponderHandlers | null>(null);

  useEffect(() => {
    setHandlers(
      PanResponder.create({
        // Not on *start*: the figure is a text field and a tap on it belongs to
        // the keyboard. Only a committed horizontal move becomes a drag — and
        // it has to out-argue the sheet, which is dragged vertically to close.
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderGrant: () => {
          dragStart.current = latest.current;
          setDragging(true);
        },
        onPanResponderMove: (_event, gesture) => {
          const from = dragStart.current;
          if (from === null) return;
          onChangeRef.current(scrub(from, gesture.dx, currencyRef.current));
        },
        // Both endings are the same ending: an interrupted drag is a drag that
        // stopped, and leaving `dragStart` set would make the next one reckon
        // from a figure that is no longer on screen.
        onPanResponderRelease: () => {
          dragStart.current = null;
          setDragging(false);
        },
        onPanResponderTerminate: () => {
          dragStart.current = null;
          setDragging(false);
        },
      }).panHandlers,
    );
  }, []);

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
        const times = beats > ACCELERATE_AFTER ? 5 : 1;
        let next = latest.current;
        for (let i = 0; i < times; i += 1) next = nudge(next, direction, currency);
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

        {/* The figure and its unit, on one line and centred between the steps.
            The pan lives on this middle block rather than the whole row, so a
            finger that starts on a step button is pressing it, not scrubbing. */}
        <View style={{ flex: 1, alignItems: 'center' }} {...(handlers ?? {})}>
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

      {/* What a step is worth, under the control that does it. It changes with
          the amount, so it is said rather than left to be discovered — and it
          doubles as the hint that the row can be dragged at all. */}
      <Text variant="micro" tone={dragging ? 'brand' : 'faint'} align="center">
        {t.quickExpense.stepHint.replace('{amount}', formatMinorInput(step, currency))}
      </Text>
    </View>
  );
}
