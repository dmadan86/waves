/**
 * What you can do about a balance with one person, from their own screen.
 *
 * The person screen rolls several groups into one headline, but a reminder, a
 * payment and a settlement are each written against a single group's ledger.
 * So the caller hands in the one group the headline is aimed at (see
 * `actionTarget`) and this reuses the group flows as they are:
 *
 * - they owe you  -> Remind (`useNudge`, the same one-a-day gentle reminder as
 *   the Friends list and the group balances);
 * - you owe them -> Pay (their stored rail, handed off the way the group's
 *   Settle tab does it) and Mark as paid (records the settlement directly);
 * - both          -> Settle up, which opens that group's settle screen.
 *
 * Nothing here moves money (ADR-007): Pay opens their payment app, then asks
 * whether it went through before anything is recorded.
 */
import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Linking, View } from 'react-native';

import { buildPaymentUri, toMajorString, type CurrencyCode } from '@waves/core';
import { Button, iconSize, Row, Text, useTheme } from '@waves/ui';

import { useGroup, useGroupLedger, useRecordSettlement } from '@/data/hooks';
import { displayName, payableAt } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useDialog } from '@/lib/dialog';
import { friendlyError } from '@/lib/errors';
import { useGuestGuard } from '@/lib/guestGuard';
import { router } from '@/lib/navigation';
import { useNudge } from '@/lib/nudge';
import { findPersonMember, type ActionTarget } from '@/lib/personActions';

export function PersonActions({
  personKey,
  name,
  target,
  currency,
  owed,
}: {
  personKey: string;
  name: string;
  target: ActionTarget;
  currency: string;
  /** True when they owe you. */
  owed: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  const { t } = useStrings();
  const { confirm, notify } = useDialog();
  const { profile } = useAuth();
  const guard = useGuestGuard();
  const { members } = useGroup(target.groupId);
  const ledger = useGroupLedger(target.groupId, profile?.id ?? null);
  const recordSettlement = useRecordSettlement(target.groupId);
  const [busy, setBusy] = useState(false);

  const member = findPersonMember(members.data ?? [], personKey);
  const myMemberId = ledger.myMemberId;
  const payable = member ? payableAt(member) : null;
  const nudge = useNudge({ groupId: target.groupId, memberId: member?.id ?? '', currency });
  // A guest has no account to notify, so a reminder to one would only fail.
  const canRemind = owed && Boolean(member) && Boolean(member?.profile_id);
  const canPay = !owed && Boolean(member) && Boolean(myMemberId);

  const record = async (): Promise<void> => {
    if (guard.blockWrite()) return;
    if (!member || !myMemberId || busy) return;
    setBusy(true);
    try {
      await recordSettlement.mutateAsync({
        groupId: target.groupId,
        fromMemberId: myMemberId,
        toMemberId: member.id,
        amount: target.amount,
        rail: payable?.rail ?? 'other',
        currency,
        allocations: [],
      });
    } catch (caught) {
      await notify({
        title: t.couldNotSave,
        body: friendlyError(caught, t.couldNotSave, 'person.record'),
      });
    } finally {
      setBusy(false);
    }
  };

  const markPaid = async (): Promise<void> => {
    const ok = await confirm({
      title: fill(t.person.markPaidTitle, { name }),
      body: t.person.markPaidBody,
      confirmLabel: t.misc.recordIt,
    });
    if (ok) await record();
  };

  const pay = async (): Promise<void> => {
    if (!member || !payable) return;
    const uri = buildPaymentUri(
      {
        railId: payable.rail,
        handle: payable.handle,
        payeeName: displayName(member),
        amount: target.amount,
        currency: currency as CurrencyCode,
        note: `Waves ${target.groupName ?? ''}`.trim(),
      },
      (value, code) => toMajorString({ minor: value, currency: code }),
    );
    // A custom scheme with nothing installed to answer it fails silently, so ask
    // first; an https link always opens.
    const canOpen = uri
      ? uri.kind === 'web' || (await Linking.canOpenURL(uri.uri).catch(() => false))
      : false;
    if (uri && canOpen) {
      await Linking.openURL(uri.uri);
      const paid = await confirm({
        title: t.extras.paymentWentThrough,
        body: t.extras.onlyIfCompleted,
        confirmLabel: t.misc.recordYes,
        cancelLabel: t.misc.recordNo,
      });
      if (paid) await record();
      return;
    }
    // No app to hand off to: show where to send it, then offer to record.
    const recordIt = await confirm({
      title: fill(t.misc.settlePayTitle, { name }),
      body: t.misc.settlePayBody
        .replace('{rail}', payable.rail)
        .replace('{handle}', payable.handle),
      confirmLabel: t.misc.recordIt,
    });
    if (recordIt) await record();
  };

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Row style={{ flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {canRemind && !nudge.outcome ? (
          <Button
            size="sm"
            variant="brand"
            label={t.people.remind}
            accessibilityLabel={fill(t.person.remindA11y, { name })}
            icon={
              <Ionicons
                name="notifications-outline"
                size={iconSize.sm}
                color={theme.color.onBrand}
              />
            }
            disabled={nudge.pending}
            onPress={nudge.send}
          />
        ) : null}
        {canPay && payable ? (
          <Button
            size="sm"
            variant="brand"
            label={t.person.pay}
            accessibilityLabel={fill(t.person.payA11y, { name })}
            icon={<Ionicons name="send-outline" size={iconSize.sm} color={theme.color.onBrand} />}
            disabled={busy}
            onPress={() => void pay()}
          />
        ) : null}
        {canPay ? (
          <Button
            size="sm"
            variant="secondary"
            label={t.person.markPaid}
            accessibilityLabel={fill(t.person.markPaidA11y, { name })}
            disabled={busy}
            onPress={() => void markPaid()}
          />
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          label={t.settleUp}
          accessibilityLabel={fill(t.person.settleUpA11y, { name })}
          onPress={() => router.push(`/group/${target.groupId}/settle`)}
        />
      </Row>
      {nudge.outcome ? (
        <Text
          variant="caption"
          tone={nudge.outcome.ok ? 'positive' : 'negative'}
          accessibilityLiveRegion="polite"
        >
          {nudge.outcome.label}
        </Text>
      ) : null}
    </View>
  );
}
