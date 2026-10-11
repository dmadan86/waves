/**
 * The "Got ₹1,602.15 from Renny?" question a Settle up row asks before it
 * writes anything.
 *
 * ## Why this is not `useDialog().confirm`
 *
 * The shared confirm is deliberately generic: a title, a paragraph and two
 * stacked doors, used by forty-odd sites. This one is the app's most-seen
 * money question and the design gives it its own face: an illustration, the
 * person and the amount on a tile, and two side-by-side doors. Bending the
 * shared dialog to carry that would push settle-only layout onto every other
 * caller, so it is built from the same overlay primitive (`Popup`) instead and
 * gets the same scrim tap and Android back behaviour for free.
 *
 * Dismissing it by any route (the X, the scrim, back, "No") is a no, exactly as
 * a declined `confirm` was: nothing is recorded.
 */

import type { ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, Pressable, View } from 'react-native';

import type { CurrencyCode } from '@waves/core';
import { Button, iconSize, MoneyText, Popup, Row, Text, useTheme } from '@waves/ui';

import { useStrings } from '@/i18n';

const WALLET_ART = require('../../../assets/images/settle-wallet.webp') as number;

/** Tall enough to read as the hero of the dialog, short enough to stay compact. */
const ART_HEIGHT = 112;
/** The wallet art's own proportions (330x176), so it is never stretched. */
const ART_WIDTH = Math.round((ART_HEIGHT * 330) / 176);
const BADGE = 40;

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

        {/* Decorative: the title says everything the picture does. The check is
            drawn over the wallet rather than baked into new art, so the badge
            takes the theme's own "good" colour. */}
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ width: ART_WIDTH, height: ART_HEIGHT, marginTop: theme.spacing.xs }}
        >
          <Image
            source={WALLET_ART}
            style={{ width: ART_WIDTH, height: ART_HEIGHT }}
            resizeMode="contain"
          />
          <View
            style={{
              position: 'absolute',
              top: 0,
              alignSelf: 'center',
              width: BADGE,
              height: BADGE,
              borderRadius: BADGE / 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.positive,
              ...theme.shadow.soft,
            }}
          >
            <Ionicons name="checkmark" size={iconSize.lg} color={theme.color.onBrand} />
          </View>
        </View>

        <Text
          variant="title"
          accessibilityRole="header"
          style={{
            fontSize: 22,
            lineHeight: 28,
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
            marginTop: theme.spacing.lg,
            paddingVertical: theme.spacing.sm,
            paddingHorizontal: theme.spacing.md,
            borderRadius: theme.radius.lg,
            backgroundColor: theme.color.brandSoft,
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

        <Row style={{ alignSelf: 'stretch', gap: theme.spacing.md, marginTop: theme.spacing.lg }}>
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
