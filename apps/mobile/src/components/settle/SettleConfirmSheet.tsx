/** Confirm a settlement before recording it. Dismissing records nothing. */

import type { ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import type { CurrencyCode } from '@waves/core';
import { Button, iconSize, MoneyText, Popup, Row, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';

export interface SettleConfirmSheetProps {
  visible: boolean;
  /** Answer yes: the caller records the payment. */
  onConfirm: () => void;
  /** Any way out: the X, "No", the scrim, Android back. Records nothing. */
  onClose: () => void;
  title: string;
  body: string;
  /** The other person: their avatar, drawn by the caller, which owns photo lookup. */
  avatar: ReactNode;
  name: string;
  /** "Paid you" or "You paid". */
  relation: string;
  amount: bigint;
  currency: CurrencyCode;
  confirmLabel: string;
}

export function SettleConfirmSheet({
  visible,
  onConfirm,
  onClose,
  title,
  body,
  avatar,
  name,
  relation,
  amount,
  currency,
  confirmLabel,
}: SettleConfirmSheetProps) {
  const theme = useTheme();
  const { t, locale } = useStrings();

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
          {title}
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
          accessibilityLabel={`${name}. ${relation}. ${title}`}
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
          <MoneyText
            amount={amount}
            currency={currency}
            locale={locale}
            variant="subheading"
            tone="brand"
            fadeFraction={false}
          />
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
              onPress={onConfirm}
              style={{ paddingHorizontal: theme.spacing.md }}
            />
          </View>
        </Row>
      </View>
    </Popup>
  );
}
