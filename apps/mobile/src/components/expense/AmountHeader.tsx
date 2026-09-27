/**
 * The amount-forward hero the expense forms share.
 *
 * The number is still the point of these screens, but it no longer costs a
 * third of the first screenful to say so. It used to be a 44pt figure, centred,
 * with the currency on its *own* line below it and nothing beside either —
 * roughly 150pt of height spent on two things that fit comfortably on one line.
 * Everything a person came to do was below the fold before they had typed
 * anything.
 *
 * So: one row. `AmountField`'s `hero` size exists for exactly this — 30pt
 * digits, documented as sitting "on one line beside the currency it is counted
 * in" — and the currency moves from under the number to beside it.
 *
 * The room that frees goes back into the two things that make an amount quick
 * to enter without a keyboard:
 *
 *   * **A stepper either side.** Tap up, tap down. `STEP_MAJOR` is deliberately
 *     one whole unit of the currency rather than the smallest: nobody adjusts a
 *     bill by a paisa, and a stepper that moves by 0.01 is a stepper nobody
 *     uses twice.
 *   * **Quick amounts.** A scrolling row of the figures people actually spend,
 *     which *add* rather than replace — so ₹50 then ₹500 is ₹550, and a
 *     mis-tap is undone by the minus beside the number rather than by clearing
 *     the field. Each chip says `+` for that reason; a chip reading plain "₹50"
 *     over a field showing ₹500 is a question, not a control.
 *
 * Both are shortcuts past the keypad, never a replacement for it: the field is
 * still a field, and a figure that is not on the ladder is still typed.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';

import { currencySymbol, minorUnitScale, type CurrencyCode } from '@waves/core';
import { AmountField, iconSize, Row, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';

/**
 * How much one press of the stepper moves the amount, in whole currency units.
 *
 * One, not the minor unit. The stepper is for "that was 251, not 250", and for
 * walking up from nothing on a small spend; the chips below cover the jumps.
 */
const STEP_MAJOR = 1n;

/**
 * The quick-amount ladder, in whole currency units.
 *
 * Not a round-number series for its own sake — it is roughly what a day's
 * cash-in-hand spending looks like: a chai, a coffee, an auto, a meal, a bill,
 * a big one. Additive, so the gaps between the rungs do not matter: ₹5 tapped
 * three times is ₹15.
 */
const QUICK_MAJOR = [5n, 10n, 50n, 100n, 500n, 1000n] as const;

/**
 * The flag for a currency, from the country its ISO code starts with — INR →
 * 🇮🇳, USD → 🇺🇸, EUR → 🇪🇺. Regional-indicator letters, so there is no image
 * set to ship; a code that does not start with two letters gets no flag.
 */
export function flagFor(currency: string): string | null {
  const country = currency.slice(0, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return null;
  return String.fromCodePoint(...[...country].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

/** A round, 44pt tap target — the floor, not a suggestion. */
function StepperButton({
  icon,
  label,
  disabled,
  onPress,
  soft = false,
}: {
  icon: 'add' | 'remove';
  label: string;
  disabled?: boolean;
  onPress: () => void;
  soft?: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.radius.pill,
        backgroundColor: soft ? theme.color.brandSoft : theme.color.surfaceMuted,
        // Disabled is said in ink as well as in state: minus at zero is the
        // only one that ever greys, and it must not read as merely unpressed.
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <Ionicons
        name={icon}
        size={iconSize.lg}
        color={disabled ? theme.color.textFaint : soft ? theme.color.brand : theme.color.text}
      />
    </Pressable>
  );
}

export function AmountHeader({
  currency,
  amount,
  onAmountChange,
  onPressCurrency,
  soft = false,
}: {
  currency: string;
  amount: bigint;
  onAmountChange: (value: bigint) => void;
  onPressCurrency: () => void;
  /**
   * The Save an expense look: steppers and quick amounts in the brand's soft
   * tint with brand ink, and the currency as an outlined pill with its flag.
   */
  soft?: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();

  // Whole units into minor units, so every figure here is stated in the units
  // people say out loud and converted once, at the edge. A currency with no
  // minor unit (yen) scales by 1 and the same ladder still reads correctly.
  const scale = minorUnitScale(currency as CurrencyCode);
  const flag = flagFor(currency);
  const step = STEP_MAJOR * scale;

  const bump = (by: bigint): void => {
    const next = amount + by;
    // Never below zero: an expense of minus ten is not a thing, and letting the
    // field hold one means a Save button that has to explain itself.
    onAmountChange(next < 0n ? 0n : next);
  };

  return (
    <View style={{ gap: theme.spacing.md, paddingTop: theme.spacing.md }}>
      {/* One line: minus, the number with its currency, plus.

          `flexShrink` on the middle and `flexShrink: 0` on the buttons, so a
          long figure eats into the number's own room rather than pushing a
          44pt target off the edge of a 360pt screen. */}
      <Row style={{ alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm }}>
        <StepperButton
          icon="remove"
          label={t.captures.amountDown}
          disabled={amount <= 0n}
          onPress={() => bump(-step)}
          soft={soft}
        />
        <Row
          style={{
            flexShrink: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: theme.spacing.xs,
          }}
        >
          <AmountField currency={currency} value={amount} onChange={onAmountChange} size="hero" />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t.captures.currencyLabel}: ${currency}`}
            onPress={onPressCurrency}
            hitSlop={8}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              flexShrink: 0,
              gap: theme.spacing.xs,
              // The 44pt floor the pill earned when it was the smallest target
              // on the form. It keeps it here, where it is smaller still.
              minHeight: 44,
              paddingVertical: theme.spacing.xs,
              paddingHorizontal: soft ? theme.spacing.md : theme.spacing.sm,
              borderRadius: theme.radius.pill,
              backgroundColor: soft ? theme.color.surface : theme.color.surfaceMuted,
              borderWidth: soft ? 1 : 0,
              borderColor: theme.color.border,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            {soft && flag ? <Text style={{ fontSize: 16 }}>{flag}</Text> : null}
            <Text variant="caption" style={{ fontWeight: '700', color: theme.color.text }}>
              {currency}
            </Text>
            <Ionicons name="chevron-down" size={iconSize.sm} color={theme.color.textMuted} />
          </Pressable>
        </Row>
        <StepperButton
          icon="add"
          label={t.captures.amountUp}
          onPress={() => bump(step)}
          soft={soft}
        />
      </Row>

      {/* The ladder. Horizontal and scrolling rather than wrapped, so it stays
          one line however many rungs it grows: a wrapping row of chips changes
          the height of the screen depending on the currency's symbol width,
          which moves everything below it for no reason a reader can see. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: theme.spacing.sm, paddingHorizontal: theme.spacing.xs }}
      >
        {QUICK_MAJOR.map((major) => {
          const label = `+${currencySymbol(currency)}${major.toString()}`;
          return (
            <Pressable
              key={major.toString()}
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={() => bump(major * scale)}
              style={({ pressed }) => ({
                minHeight: 40,
                justifyContent: 'center',
                paddingHorizontal: theme.spacing.md,
                borderRadius: theme.radius.pill,
                borderWidth: soft ? 0 : 1,
                borderColor: theme.color.border,
                backgroundColor: soft ? theme.color.brandSoft : theme.color.surface,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text
                variant="caption"
                style={{
                  fontWeight: soft ? '700' : '600',
                  color: soft ? theme.color.brand : theme.color.text,
                }}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
