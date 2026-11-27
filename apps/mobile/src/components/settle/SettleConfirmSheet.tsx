/** Confirm a settlement before recording it. Dismissing records nothing. */

import { useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import {
  checkPartialAmount,
  format,
  money,
  PartialCheck,
  remainderAfter,
  type CurrencyCode,
} from '@waves/core';
import {
  AmountField,
  Button,
  Chip,
  iconSize,
  MoneyText,
  Popup,
  Row,
  Text,
  useTheme,
} from '@waves/ui';

import { fill, useStrings } from '@/i18n';
import { SETTLE_METHODS, type SettleMethod } from '@/lib/settleMethod';

export interface SettleConfirmSheetProps {
  visible: boolean;
  /** Answer yes: the caller records the payment, by the method picked. */
  onConfirm: (method: SettleMethod, amount: bigint) => void;
  /** How the money moved to start with; the person can change it before saying yes. */
  defaultMethod: SettleMethod;
  /** Any way out: the X, "No", the scrim, Android back. Records nothing. */
  onClose: () => void;
  /** A function when the title names the amount, which the person may edit. */
  title: string | ((amount: bigint) => string);
  body: string;
  /** The other person: their avatar, drawn by the caller, which owns photo lookup. */
  avatar: ReactNode;
  name: string;
  /** "Paid you" or "You paid". */
  relation: string;
  /** What is owed. */
  amount: bigint;
  currency: CurrencyCode;
  confirmLabel: string;
  /** Let the amount be lowered to a part payment (never raised past `amount`). */
  editable?: boolean;
  /** Hide the how-did-you-pay chips (the pay hand-off picks the rail itself). */
  hideMethods?: boolean;
}

export function SettleConfirmSheet({
  visible,
  onConfirm,
  defaultMethod,
  onClose,
  title,
  body,
  avatar,
  name,
  relation,
  amount,
  currency,
  confirmLabel,
  editable = false,
  hideMethods = false,
}: SettleConfirmSheetProps) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const [method, setMethod] = useState<SettleMethod>(defaultMethod);
  const [entered, setEntered] = useState(amount);
  const shown = editable ? entered : amount;
  const check = editable ? checkPartialAmount(entered, amount) : PartialCheck.Ok;
  const left = remainderAfter(amount, shown);
  const fmt = (value: bigint): string => format(money(value, currency), { locale });
  const heading = typeof title === 'function' ? title(shown) : title;
  // Each time the sheet opens it starts from the default again (adjusted in
  // render rather than in an effect, so there is no flash of the old choice).
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setMethod(defaultMethod);
      setEntered(amount);
    }
  }

  return (
    <Popup visible={visible} onClose={onClose} closeLabel={t.misc.recordNo}>
      <View style={{ alignItems: 'center' }}>
        {/* Top-end, not top-right, so it follows the reading direction in RTL. */}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t.common.close}
          hitSlop={8}
          style={{
            position: 'absolute',
            top: 0,
            end: 0,
            width: 32,
            height: 32,
            borderRadius: theme.radius.pill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.surfaceMuted,
            zIndex: 1,
          }}
        >
          <Ionicons name="close" size={iconSize.md} color={theme.color.text} />
        </Pressable>

        <Text
          variant="title"
          accessibilityRole="header"
          style={{
            fontSize: 20,
            lineHeight: 26,
            paddingHorizontal: 32,
            textAlign: 'center',
            marginTop: theme.spacing.sm,
          }}
        >
          {heading}
        </Text>
        <Text
          variant="body"
          tone="muted"
          style={{ textAlign: 'center', marginTop: theme.spacing.xs }}
        >
          {body}
        </Text>

        {/* One fact, one stop for a screen reader: who, which way, how much. */}
        <Row
          accessible
          accessibilityLabel={`${name}. ${relation}. ${heading}`}
          style={{
            alignSelf: 'stretch',
            gap: theme.spacing.md,
            marginTop: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
            paddingHorizontal: theme.spacing.md,
            borderBottomWidth: 1,
            borderBottomColor: theme.color.border,
          }}
        >
          {avatar}
          <View style={{ flex: 1 }}>
            <Text variant="subheading" numberOfLines={1}>
              {name}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {relation}
            </Text>
          </View>
          {editable ? (
            <View style={{ minWidth: 110 }}>
              <AmountField
                size="compact"
                framed
                currency={currency}
                value={entered}
                onChange={setEntered}
              />
            </View>
          ) : (
            <MoneyText
              exact
              amount={amount}
              currency={currency}
              locale={locale}
              variant="subheading"
              tone="brand"
              fadeFraction={false}
            />
          )}
        </Row>
        {editable && check !== PartialCheck.Empty ? (
          <Text
            variant="caption"
            tone={check === PartialCheck.Over ? undefined : 'muted'}
            accessibilityLiveRegion="polite"
            style={{
              alignSelf: 'stretch',
              marginTop: theme.spacing.xs,
              color: check === PartialCheck.Over ? theme.color.negative : undefined,
            }}
          >
            {check === PartialCheck.Over
              ? fill(t.misc.settleAmountOver, { amount: fmt(amount) })
              : left > 0n
                ? fill(t.misc.settleLeft, { amount: fmt(left) })
                : null}
          </Text>
        ) : null}

        <Row
          style={{
            alignSelf: 'stretch',
            flexWrap: 'wrap',
            gap: theme.spacing.xs,
            marginTop: theme.spacing.md,
          }}
        >
          {(hideMethods ? [] : SETTLE_METHODS).map((id) => (
            <Chip
              key={id}
              label={t.groupExport.methods[id]}
              selected={method === id}
              onPress={() => setMethod(id)}
            />
          ))}
        </Row>

        <Row style={{ alignSelf: 'stretch', gap: theme.spacing.md, marginTop: theme.spacing.md }}>
          <View style={{ flex: 1 }}>
            <Button
              label={t.misc.recordNo}
              variant="ghost"
              fullWidth
              onPress={onClose}
              style={{
                borderWidth: 1,
                borderColor: theme.color.brand,
                paddingHorizontal: theme.spacing.md,
              }}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label={confirmLabel}
              variant="brand"
              fullWidth
              disabled={check !== PartialCheck.Ok}
              onPress={() => onConfirm(method, shown)}
              style={{ paddingHorizontal: theme.spacing.md }}
            />
          </View>
        </Row>
      </View>
    </Popup>
  );
}
