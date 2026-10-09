/**
 * A payment I said I made that the payee has not confirmed yet.
 *
 * One card, left to right: who was paid and how much, then the controls — the
 * proof thumbnail (when one is attached), a Proof tile to add or replace it,
 * and a Cancel tile to withdraw the claim. The behaviour all lives in
 * `SettlementProof` and the caller's `onCancel`; this is only the layout, so
 * the card reads as a status with two obvious actions rather than a stack of
 * full-width buttons.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import type { CurrencyCode } from '@waves/core';
import { Avatar, iconSize, MoneyText, Row, Text, useTheme } from '@waves/ui';

import { PendingMark } from '@/components/PendingMark';
import { SettlementProof, TILE, tileDivider } from '@/components/SettlementProof';
import { useStrings } from '@/i18n';

export function PendingPaymentCard({
  groupId,
  settlementId,
  payeeName,
  amount,
  currency,
  locale,
  unsynced,
  cancelling,
  onCancel,
}: {
  groupId: string;
  settlementId: string;
  payeeName: string;
  amount: bigint;
  currency: CurrencyCode;
  locale: string;
  /** Still queued locally: the proof RPCs need a server row, so Proof waits. */
  unsynced: boolean;
  cancelling: boolean;
  onCancel: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        backgroundColor: theme.color.surface,
        borderRadius: theme.radius.lg,
        padding: theme.spacing.md,
      }}
    >
      <Avatar name={payeeName} size={44} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {t.proof.youPaidLabel}
        </Text>
        <Text variant="subheading" style={{ fontWeight: '700' }} numberOfLines={1}>
          {payeeName}
        </Text>
        <Row style={{ gap: theme.spacing.sm, alignItems: 'center' }}>
          {/* Fraction fades by default: the whole units are what is being claimed. */}
          <MoneyText amount={amount} currency={currency} locale={locale} variant="title" />
          {unsynced ? <PendingMark size={16} /> : null}
        </Row>
        <Row style={{ gap: theme.spacing.xs, alignItems: 'center' }}>
          <Ionicons name="time-outline" size={iconSize.sm} color={theme.color.textMuted} />
          <Text variant="micro" tone="muted" numberOfLines={2} style={{ flexShrink: 1 }}>
            {t.proof.waiting}
          </Text>
        </Row>
      </View>
      {/* Manage only once the settlement has reached the server: the attach and
          remove RPCs check party against a real row, and `pending` means it has
          not synced yet. Until then the card still says "waiting", just without
          the attach control. */}
      <SettlementProof
        groupId={groupId}
        settlementId={settlementId}
        canManage={!unsynced}
        layout="tiles"
      />
      <View style={tileDivider(theme)} />
      {/* Withdraw a payment recorded by mistake or twice. Queued like every
          other mutation, so even a still-syncing claim cancels cleanly — the
          create runs before the cancel in the ordered queue. */}
      <Pressable
        onPress={onCancel}
        disabled={cancelling}
        accessibilityRole="button"
        accessibilityLabel={t.group.cancelSettlement}
        style={({ pressed }) => ({
          alignItems: 'center',
          gap: theme.spacing.xs,
          opacity: cancelling ? 0.5 : pressed ? 0.6 : 1,
        })}
      >
        <View
          style={{
            width: TILE,
            height: TILE,
            borderRadius: theme.radius.md,
            backgroundColor: theme.color.negativeSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="trash-outline" size={iconSize.lg} color={theme.color.negative} />
        </View>
        <Text variant="caption" tone="negative">
          {t.common.cancel}
        </Text>
      </Pressable>
    </View>
  );
}
