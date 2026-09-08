/**
 * How a spend was paid — a horizontal row of chips (cash, UPI, card, …).
 *
 * The id is what persists to the free-text `payment_method` column, so any of
 * these is safe to store; the icon and label are UI. Debit wears the filled
 * card so it reads apart from credit's outline at chip size. `upi` is offered
 * only where the rail exists (see `deviceSupportsUpi`); everywhere else the row
 * is the region rails a person would recognise. One row that scrolls sideways
 * rather than wrapping, so the block keeps a fixed height however many rails a
 * region offers.
 *
 * Shared so the capture screen, add-expense, and add-person all speak the same
 * language for the same field.
 *
 * `PaymentMethodRow` + `PaymentMethodSheet` are the same rails as a list: a
 * settings row naming the field and showing the rail in force, and the options
 * behind it. Same ids, same labels, same order — only the presentation differs,
 * for forms that read as a list of settings rather than a stack of chip lanes.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';

import { type PaymentMethod } from '@waves/core';
import { iconSize, Text, useTheme } from '@waves/ui';

import { ChoiceRow, SettingRow, SheetOverlay } from '@/components/expense/SheetOverlay';
import { deviceSupportsUpi, useStrings } from '@/i18n';
import { offeredPaymentMethods } from '@/lib/paymentMethods';

const PAYMENT_METHOD_ICONS: Readonly<Record<PaymentMethod, keyof typeof Ionicons.glyphMap>> = {
  cash: 'cash-outline',
  upi: 'phone-portrait-outline',
  credit: 'card-outline',
  debit: 'card',
  forex: 'swap-horizontal-outline',
};

/**
 * Two shapes, one picker. The group add-expense screen always has a method
 * chosen (cash by default) and only ever swaps it, so its `onChange` never sees
 * null. The capture screen lets "not said" be a valid answer — tapping the
 * chosen chip again clears it — so under `allowDeselect` the same tap can hand
 * back null. The discriminated union keeps each caller's `onChange` honest about
 * which it will receive.
 */
type PaymentMethodPickerProps =
  | { value: PaymentMethod | null; onChange: (value: PaymentMethod) => void; allowDeselect?: false }
  | {
      value: PaymentMethod | null;
      onChange: (value: PaymentMethod | null) => void;
      allowDeselect: true;
    };

/**
 * The rail's name, in the phone's language. A hook rather than a free function
 * because the strings come from context, and every presentation of this field —
 * chips, row, sheet — must name a rail the same way.
 */
function usePaymentMethodLabel(): (id: PaymentMethod) => string {
  const { t } = useStrings();
  return (id) => {
    switch (id) {
      case 'cash':
        return t.captures.payCash;
      case 'upi':
        return t.captures.payUpi;
      case 'credit':
        return t.captures.payCredit;
      case 'debit':
        return t.captures.payDebit;
      case 'forex':
        return t.captures.payForex;
    }
  };
}

export function PaymentMethodPicker(props: PaymentMethodPickerProps) {
  const { value } = props;
  const theme = useTheme();
  const label = usePaymentMethodLabel();
  const methods = offeredPaymentMethods({ upiSupported: deviceSupportsUpi(), current: value });

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: theme.spacing.sm, paddingRight: theme.spacing.xl }}
    >
      {methods.map((method) => {
        const active = value === method;
        return (
          <Pressable
            key={method}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={label(method)}
            onPress={() => {
              if (props.allowDeselect) {
                props.onChange(active ? null : method);
              } else {
                props.onChange(method);
              }
            }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.xs,
              // Match the category chips: a 44pt floor so the tap target clears
              // the iOS 44 / Android 48 minimum (padding alone left it ~37pt).
              minHeight: 44,
              paddingVertical: theme.spacing.sm,
              paddingHorizontal: theme.spacing.md,
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: active ? theme.color.brand : theme.color.border,
              backgroundColor: active ? theme.color.brandSoft : theme.color.surface,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons
              name={PAYMENT_METHOD_ICONS[method]}
              size={iconSize.md}
              color={active ? theme.color.brand : theme.color.textMuted}
            />
            <Text variant="body" style={{ color: active ? theme.color.brand : theme.color.text }}>
              {label(method)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * The rail in force as one row of a settings list: the field's name, the rail's
 * glyph and label, a chevron into {@link PaymentMethodSheet}.
 *
 * Only the non-deselectable shape: a list row has to show *something* on its
 * right, and "not said" is a state the chip lane can express by having nothing
 * lit but a row cannot. The screens that allow "not said" keep the chips.
 */
export function PaymentMethodRow({
  value,
  onPress,
}: {
  value: PaymentMethod;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const label = usePaymentMethodLabel();
  const method = offeredPaymentMethods({ upiSupported: deviceSupportsUpi(), current: value }).find(
    (it) => it === value,
  );

  return (
    <SettingRow
      label={t.captures.paidWith}
      value={label(value)}
      leading={
        method ? (
          <Ionicons name={PAYMENT_METHOD_ICONS[method]} size={iconSize.md} color={theme.color.textMuted} />
        ) : null
      }
      onPress={onPress}
    />
  );
}

/** The same rails as a sheet of options, one per line, checked where chosen. */
export function PaymentMethodSheet({
  value,
  onChange,
  onClose,
}: {
  value: PaymentMethod | null;
  onChange: (value: PaymentMethod) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const label = usePaymentMethodLabel();

  return (
    <SheetOverlay title={t.captures.paidWith} onClose={onClose}>
      <View style={{ gap: theme.spacing.xs }}>
        {offeredPaymentMethods({ upiSupported: deviceSupportsUpi(), current: value }).map((method) => {
          const active = value === method;
          return (
            <ChoiceRow
              key={method}
              label={label(method)}
              selected={active}
              leading={
                // A fixed-width box so every label starts on the same line
                // however wide its glyph draws, the way the currency sheet's
                // symbols are boxed.
                <View style={{ width: 32, alignItems: 'center' }}>
                  <Ionicons
                    name={PAYMENT_METHOD_ICONS[method]}
                    size={iconSize.md}
                    color={active ? theme.color.brand : theme.color.textMuted}
                  />
                </View>
              }
              onPress={() => onChange(method)}
            />
          );
        })}
      </View>
    </SheetOverlay>
  );
}
