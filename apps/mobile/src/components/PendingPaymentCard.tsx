/**
 * A payment I recorded that the payee has not confirmed yet — the card at the
 * top of the group's Expenses tab.
 *
 * Three lines, built to hold at 360dp without the amount wrapping or the name
 * being cut to a stub:
 *
 *   1. avatar · "You paid Renny Benita" · ₹26,328.00 (one line each, shrinking
 *      before wrapping),
 *   2. "Paid on 8 Oct · Waiting for confirmation" (the date opens a picker),
 *   3. the proof thumbnails with an add tile (up to five),
 *   4. compact actions: Remind, Add proof, Cancel payment.
 *
 * Remind is once a day per payment (the server holds the line). A payee on
 * Waves gets a push; someone who is not gets a WhatsApp / share-sheet message
 * written here, after which the server is told so the day's limit still counts.
 */

import { Fragment, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ActivityIndicator, Linking, Platform, Pressable, Share, View } from 'react-native';

import { format, money, type CurrencyCode } from '@waves/core';
import { Avatar, Card, iconSize, MoneyText, Row, Text, useTheme } from '@waves/ui';

import { PendingMark } from '@/components/PendingMark';
import { SettlementProof, useAddProof } from '@/components/SettlementProof';
import {
  useCancelSettlement,
  useRemindSettlement,
  useSetSettlementPaidAt,
  useSettlementProofs,
} from '@/data/hooks';
import { isGhost, type MemberRow, type SettlementRow } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { useDialog } from '@/lib/dialog';
import { friendlyError } from '@/lib/errors';
import {
  canAddProof,
  clampPaidDay,
  fillReminder,
  formatPaidDay,
  localDay,
  paidDay,
  remindState,
  RemindUnit,
  reminderUrls,
} from '@/lib/paymentProof';

/** One of the card's three equal, flat actions: icon and label, no fill. */
function Action({
  label,
  icon,
  onPress,
  disabled,
  busy,
  tone = 'brand',
  accessibilityLabel,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  tone?: 'brand' | 'muted' | 'danger';
  accessibilityLabel?: string;
}): React.JSX.Element {
  const theme = useTheme();
  const color =
    tone === 'danger'
      ? theme.color.negative
      : tone === 'muted'
        ? theme.color.textFaint
        : theme.color.brand;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: Boolean(disabled || busy) }}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        height: 36,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator size="small" color={color} />
      ) : (
        <Ionicons name={icon} size={iconSize.sm} color={color} />
      )}
      <Text variant="caption" numberOfLines={1} style={{ color, fontWeight: '600', flexShrink: 1 }}>
        {label}
      </Text>
    </Pressable>
  );
}

function ActionDivider(): React.JSX.Element {
  const theme = useTheme();
  return <View style={{ width: 1, height: 18, backgroundColor: theme.color.border }} />;
}

export function PendingPaymentCard({
  groupId,
  groupName,
  settlement,
  payee,
  payeeName,
  locale,
}: {
  groupId: string;
  groupName: string;
  settlement: SettlementRow;
  payee: MemberRow | undefined;
  payeeName: string;
  locale: string;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const { confirm, notify } = useDialog();
  const cancelSettlement = useCancelSettlement(groupId);
  const remind = useRemindSettlement(settlement.id);
  const setPaidAt = useSetSettlementPaidAt(settlement.id);
  const adder = useAddProof(groupId, settlement.id);
  const proofs = useSettlementProofs(settlement.id);
  const [showDate, setShowDate] = useState(false);
  const [sending, setSending] = useState(false);
  // The server's stamp arrives with the next pull; until then, the one we just made.
  const [justReminded, setJustReminded] = useState<string | null>(null);
  // When the card was drawn: "Reminded 2h ago" is read against this.
  const [now] = useState(() => Date.now());

  // Everything but Cancel needs a row the server has — the RPCs answer about a
  // real settlement, and a still-queued one is not one yet.
  const synced = !settlement.pending;
  const day = paidDay(settlement);
  const stamped =
    justReminded && (!settlement.reminded_at || justReminded > settlement.reminded_at)
      ? justReminded
      : (settlement.reminded_at ?? null);
  const reminder = remindState(stamped, now);
  const agoText = (ago: NonNullable<typeof reminder.ago>): string =>
    fill(
      ago.unit === RemindUnit.Minutes
        ? t.proof.agoMinutes
        : ago.unit === RemindUnit.Hours
          ? t.proof.agoHours
          : t.proof.agoDays,
      { n: ago.n },
    );

  const amountText = format(money(BigInt(settlement.amount), settlement.currency as CurrencyCode), {
    locale,
  });

  const sendExternally = async (): Promise<boolean> => {
    const text = fillReminder(t.proof.remindMessage, {
      name: payeeName,
      amount: amountText,
      group: groupName,
      date: formatPaidDay(day, locale),
    });
    for (const url of reminderUrls(payee?.invite_phone, text)) {
      try {
        await Linking.openURL(url);
        return true;
      } catch {
        // Not installed; try the next door.
      }
    }
    const result = await Share.share({ message: text });
    return result.action !== Share.dismissedAction;
  };

  const onRemind = async (): Promise<void> => {
    if (sending || remind.isPending) return;
    setSending(true);
    try {
      // Not on Waves: the message leaves from this phone, and only once it has
      // does the server count the day.
      if (payee && isGhost(payee)) {
        if (!(await sendExternally())) return;
        await remind.mutateAsync();
      } else if ((await remind.mutateAsync()) === 'external') {
        await sendExternally();
      }
      setJustReminded(new Date().toISOString());
    } catch (caught) {
      if (caught instanceof Error && caught.message.includes('REMIND_RATE_LIMIT')) {
        setJustReminded(new Date().toISOString());
      } else {
        void notify({
          title: friendlyError(caught, t.proof.remindFailed, 'settlement.remind'),
          tone: 'danger',
        });
      }
    } finally {
      setSending(false);
    }
  };

  const onCancel = (): void => {
    void confirm({
      title: t.group.cancelTitle,
      body: fill(t.group.cancelBody, { name: payeeName }),
      confirmLabel: t.group.cancelConfirm,
      cancelLabel: t.group.keep,
      tone: 'danger',
    }).then((ok) => {
      if (ok) cancelSettlement.mutate(settlement.id);
    });
  };

  const datePart = fill(t.proof.paidOn, { date: formatPaidDay(day, locale) });

  const remindAction = !synced ? null : reminder.available ? (
    <Action
      label={t.proof.remind}
      icon="notifications-outline"
      busy={sending}
      onPress={() => void onRemind()}
      accessibilityLabel={fill(t.proof.remindA11y, { name: payeeName })}
    />
  ) : (
    <Action
      label={fill(t.proof.reminded, { ago: reminder.ago ? agoText(reminder.ago) : '' })}
      icon="checkmark"
      tone="muted"
      disabled
      onPress={() => {}}
    />
  );
  const addAction =
    synced && canAddProof(proofs.data?.length ?? 0) ? (
      <Action
        label={t.proof.addShort}
        icon="camera-outline"
        busy={adder.pending}
        onPress={adder.add}
        accessibilityLabel={t.proof.add}
      />
    ) : null;
  const actions = [remindAction, addAction].filter(Boolean);

  return (
    <Card
      padded={false}
      style={{
        borderWidth: 1,
        borderColor: theme.color.border,
        paddingTop: theme.spacing.md,
        paddingHorizontal: theme.spacing.md,
        paddingBottom: theme.spacing.xs,
        gap: theme.spacing.xs,
      }}
    >
      <Row style={{ gap: theme.spacing.md, alignItems: 'center' }}>
        <Avatar name={payeeName} ghost={payee ? isGhost(payee) : false} size={40} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="body" numberOfLines={1}>
            {fill(t.proof.youPaid, { name: payeeName })}
          </Text>
          <Row style={{ alignItems: 'center', gap: 6 }}>
            <MoneyText
              amount={BigInt(settlement.amount)}
              currency={settlement.currency as CurrencyCode}
              locale={locale}
              variant="body"
              numberOfLines={1}
              style={{ flexShrink: 0, fontWeight: '700', fontSize: 19 }}
            />
            {settlement.pending ? <PendingMark size={14} /> : null}
          </Row>
          <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
            {synced ? (
              <Pressable
                onPress={() => setShowDate(true)}
                accessibilityRole="button"
                accessibilityLabel={`${datePart}. ${t.proof.changeDate}`}
                hitSlop={{ top: 6, bottom: 6 }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  alignSelf: 'flex-start',
                }}
              >
                <Text variant="micro" tone="muted">
                  {datePart}
                </Text>
                <Ionicons name="create-outline" size={12} color={theme.color.textMuted} />
              </Pressable>
            ) : (
              <Text variant="micro" tone="muted">
                {datePart}
              </Text>
            )}
            <Row style={{ alignItems: 'center', gap: 3, flexShrink: 1, minWidth: 0 }}>
              <Ionicons name="time-outline" size={12} color={theme.color.textMuted} />
              <Text variant="micro" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                {t.proof.awaitingShort}
              </Text>
            </Row>
          </Row>
        </View>
        {/* The proofs, stacked: one thumbnail and a "+N", opening the viewer. */}
        <SettlementProof
          groupId={groupId}
          settlementId={settlement.id}
          canManage={synced}
          adder={adder}
          stack
        />
      </Row>
      {showDate ? (
        <DateTimePicker
          value={new Date(`${day}T12:00:00`)}
          mode="date"
          maximumDate={new Date()}
          onChange={(event, picked) => {
            if (Platform.OS !== 'ios') setShowDate(false);
            if (event.type !== 'set' || !picked) return;
            const next = clampPaidDay(localDay(picked), new Date());
            if (next === day) return;
            setPaidAt.mutate(next, {
              onError: (caught) =>
                void notify({
                  title: friendlyError(caught, t.couldNotSave, 'settlement.paidAt'),
                  tone: 'danger',
                }),
            });
          }}
        />
      ) : null}

      <Row style={{ alignItems: 'center' }}>
        {actions.map((action, i) => (
          <Fragment key={i}>
            {action}
            <ActionDivider />
          </Fragment>
        ))}
        {/* Withdraw a payment recorded by mistake or twice. Queued like every
            other mutation, so even a still-syncing claim cancels cleanly — the
            create runs before the cancel in the ordered queue. */}
        <Action
          label={t.common.cancel}
          icon="trash-outline"
          tone="danger"
          disabled={cancelSettlement.isPending}
          onPress={onCancel}
          accessibilityLabel={t.group.cancelSettlement}
        />
      </Row>
    </Card>
  );
}
