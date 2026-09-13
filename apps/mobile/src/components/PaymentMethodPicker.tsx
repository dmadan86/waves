/**
 * How a spend was paid — the rail's own glyph and label, wherever the field is
 * asked or answered.
 *
 * The id is what persists to the free-text `payment_method` column, so any of
 * these is safe to store; the icon and label are UI. Debit wears the filled
 * card so it reads apart from credit's outline. `upi` is offered only where the
 * rail exists (see `deviceSupportsUpi`); everywhere else the row is the region
 * rails a person would recognise.
 *
 * `PaymentMethodRow` + `PaymentMethodSheet` are the field as a settings row and
 * the sheet of options behind it — a settings row naming the field and showing
 * the rail in force, one per line with a check against the one chosen. Shared
 * so the capture screen and add-expense both fold "paid with" into the same
 * card of facts the expense screen states a filed bill's answers in, rather
 * than each screen drawing its own idea of the same question. Add-expense
 * always has a rail chosen (cash by default) and only ever swaps it; capture
 * lets "not said" stand as a real answer — a person who has not decided yet
 * should not have to guess — so both the row and the sheet carry the same
 * `allowDeselect` shape `DetailRow`'s own picker siblings use: tapping the rail
 * already chosen clears it back to unsaid instead of doing nothing.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import { type PaymentMethod } from '@waves/core';
import { iconSize, useTheme } from '@waves/ui';

import { DetailRow } from '@/components/DetailRows';
import { ChoiceRow, SheetOverlay } from '@/components/expense/SheetOverlay';
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
 * The rail's name, in the phone's language. A hook rather than a free function
 * because the strings come from context, and every presentation of this field —
 * row, sheet — must name a rail the same way.
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

/**
 * The rail in force as one row of a settings list: the rail's glyph, the field's
 * name, the rail's label, a chevron into {@link PaymentMethodSheet}.
 *
 * A {@link DetailRow}, the row the expense screen states a bill's facts in, so
 * "paid with" is asked in the shape it is read back in. A null value — capture's
 * "not said", never reachable from add-expense's always-chosen state — draws
 * the same placeholder styling {@link DetailRows}'s group row uses for "decide
 * later": a faint answer rather than a blank one, so the row still says there
 * is a question here to answer.
 */
export function PaymentMethodRow({
  value,
  onPress,
}: {
  value: PaymentMethod | null;
  onPress: () => void;
}) {
  const { t } = useStrings();
  const label = usePaymentMethodLabel();
  const method = value
    ? offeredPaymentMethods({ upiSupported: deviceSupportsUpi(), current: value }).find(
        (it) => it === value,
      )
    : null;

  return (
    <DetailRow
      // A rail the region does not offer, or none chosen at all, still has to
      // draw *some* mark, or the row loses the column the stack next to it is
      // read down. The wallet is the field's own glyph, standing in for the
      // answer's.
      icon={method ? PAYMENT_METHOD_ICONS[method] : 'wallet-outline'}
      label={t.captures.paidWith}
      value={value ? label(value) : t.captures.paidNotSaid}
      placeholder={!value}
      onPress={onPress}
    />
  );
}

/**
 * The same rails as a sheet of options, one per line, checked where chosen.
 *
 * Two shapes, like the row above it: add-expense's `onChange` never sees null,
 * because that screen always has a rail chosen and only ever swaps it. Capture
 * allows "not said", so under `allowDeselect` tapping the rail already checked
 * clears it rather than re-choosing the same thing — the sheet's equivalent of
 * the old chip lane's "tap the lit one again" gesture.
 */
type PaymentMethodSheetProps =
  | {
      value: PaymentMethod;
      onChange: (value: PaymentMethod) => void;
      allowDeselect?: false;
      onClose: () => void;
    }
  | {
      value: PaymentMethod | null;
      onChange: (value: PaymentMethod | null) => void;
      allowDeselect: true;
      onClose: () => void;
    };

export function PaymentMethodSheet(props: PaymentMethodSheetProps): React.JSX.Element {
  const { value, onClose } = props;
  const theme = useTheme();
  const { t } = useStrings();
  const label = usePaymentMethodLabel();

  return (
    <SheetOverlay title={t.captures.paidWith} onClose={onClose}>
      <View style={{ gap: theme.spacing.xs }}>
        {offeredPaymentMethods({ upiSupported: deviceSupportsUpi(), current: value }).map(
          (method) => {
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
                onPress={() => {
                  if (props.allowDeselect) {
                    props.onChange(active ? null : method);
                  } else {
                    props.onChange(method);
                  }
                }}
              />
            );
          },
        )}
      </View>
    </SheetOverlay>
  );
}
