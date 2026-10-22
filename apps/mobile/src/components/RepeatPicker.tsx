/**
 * The pieces of "how often" shared by every form that repeats something: the
 * sheet of named patterns and the day / month stepper. Moved out of the personal
 * entry form so the group expense form asks the question the same way.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { FREQUENCIES, type Frequency } from '@waves/core';
import { iconSize, Row, Text, useTheme } from '@waves/ui';

import { ChoiceRow, SheetOverlay } from '@/components/expense/SheetOverlay';
import { useStrings } from '@/i18n';
import { frequencyLabel } from '@/lib/frequencyLabel';

/**
 * How often, as a sheet of named patterns — the same list of choices with a
 * check against the one in force that every other short answer on this form
 * opens.
 *
 * "Never" leads it, because not repeating is what almost every entry is, and
 * because the row it comes back to has to be able to say so. It is offered only
 * while the form is writing a transaction: a rule cannot become a one-off
 * without abandoning the history filed under its id, so an existing one is
 * stopped by pausing or deleting it instead.
 */
export function RepeatSheet<R extends { frequency: Frequency; interval: number }>({
  value,
  fallback,
  canStop,
  onChange,
  onClose,
}: {
  value: R | null;
  /** What a pattern is added to when nothing is chosen yet. */
  fallback: R;
  canStop: boolean;
  onChange: (next: R | null) => void;
  onClose: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const base = value ?? fallback;

  return (
    <SheetOverlay title={t.personal.repeats} onClose={onClose}>
      <View style={{ gap: theme.spacing.xs }}>
        {canStop ? (
          <ChoiceRow
            label={t.personal.repeatsNever}
            selected={value === null}
            leading={
              <Ionicons
                name="close-circle-outline"
                size={iconSize.md}
                color={theme.color.textMuted}
              />
            }
            onPress={() => onChange(null)}
          />
        ) : null}
        {FREQUENCIES.map((option) => (
          <ChoiceRow
            key={option}
            label={frequencyLabel(t, option, base.interval)}
            selected={value?.frequency === option}
            leading={
              <Ionicons
                name="repeat"
                size={iconSize.md}
                color={value?.frequency === option ? theme.color.brand : theme.color.textMuted}
              />
            }
            onPress={() => onChange({ ...base, frequency: option })}
          />
        ))}
      </View>
    </SheetOverlay>
  );
}

/** A plain number stepper. Two 44pt targets beat a keyboard for a value that
 *  only ever moves a step at a time, and it cannot be typed into an invalid
 *  state. */
export function DayStepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}) {
  const theme = useTheme();
  const step = (delta: number): void => {
    const next = value + delta;
    if (next >= min && next <= max) onChange(next);
  };
  const button = (delta: number, icon: 'remove' | 'add', disabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${icon === 'add' ? '+' : '−'}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => step(delta)}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.radius.md,
        backgroundColor: theme.color.surfaceMuted,
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={iconSize.md} color={theme.color.text} />
    </Pressable>
  );

  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
      <Text variant="body" style={{ flexShrink: 1, minWidth: 0 }}>
        {label}
      </Text>
      <Row style={{ gap: theme.spacing.sm, alignItems: 'center' }}>
        {button(-1, 'remove', value <= min)}
        <Text variant="body" style={{ fontWeight: '700', minWidth: 28, textAlign: 'center' }}>
          {value}
        </Text>
        {button(1, 'add', value >= max)}
      </Row>
    </Row>
  );
}
