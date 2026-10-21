/**
 * The trip wrap-up's "settle up", inside the card: who pays whom, with a
 * "Record payment" per row and a "Remind" for the people who owe you.
 *
 * It reads the plan from the ledger (`useGroupLedger`, simplified or pairwise as
 * the group chose) and records through the same `useRecordSettlement` the
 * Settle up screen uses (Waves records a payment; it never moves money, ADR-007).
 * Payments between two other people are counted, not listed: they are not yours
 * to record.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { defaultRailForCurrency, format, money, type CurrencyCode } from '@waves/core';
import { Button, Text, useTheme } from '@waves/ui';

import { SettleConfirmSheet } from '@/components/settle/SettleConfirmSheet';
import { useBlockedUsers } from '@/data/blocked';
import {
  memberLookup,
  toLedgerSnapshots,
  useGroup,
  useGroupLedger,
  useRecordSettlement,
} from '@/data/hooks';
import { groupLabel, isGhost, type MemberRow } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { receivablesFor, recordInline, settlementFor } from '@/lib/assistantInline';
import { useAuth } from '@/lib/auth';
import { useGuestGuard } from '@/lib/guestGuard';
import { hasLeft, memberNameById } from '@/lib/memberName';
import { isRatelessTransfer } from '@/lib/settleCurrency';
import { owedRowModel } from '@/lib/settleRow';
import { splitSettlePlan, type PlanTransfer } from '@/lib/settlePlan';
import { useRemind } from '@/lib/useRemind';
import { PersonAvatar } from '@/components/PersonAvatar';

export function InlineSettle({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const s = t.inline;
  const { profile } = useAuth();
  const { blockedIds } = useBlockedUsers();
  const { group, members, everyone, expenses } = useGroup(groupId);
  const ledger = useGroupLedger(groupId, profile?.id ?? null);
  const recordSettlement = useRecordSettlement(groupId);
  const guard = useGuestGuard();
  const lock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<ReadonlySet<string>>(new Set());

  const currency = group.data?.default_currency ?? 'INR';
  const converts = ledger.convertsToGroupCurrency;
  const lookup = useMemo(() => memberLookup(everyone.data), [everyone.data]);
  const split = useMemo(
    () => splitSettlePlan(ledger.transfers, ledger.myMemberId),
    [ledger.transfers, ledger.myMemberId],
  );
  const payable = (tr: PlanTransfer): boolean => !isRatelessTransfer(tr, currency, converts);
  const owedToMe = split.owesMe.filter(payable);
  const iOwe = split.iOwe.filter(payable);
  const nameOf = (id: string): string =>
    memberNameById(lookup, id, {
      viewerId: null,
      blocked: blockedIds,
      someone: t.misc.someone,
      leftLabel: t.misc.memberLeft,
      bare: true,
    });
  const fmt = (minor: bigint, code: string): string =>
    format(money(minor, code as CurrencyCode), { locale });
  const keyOf = (tr: PlanTransfer): string => `${tr.from}>${tr.to}>${tr.currency}>${tr.amount}`;

  const record = useCallback(
    async (tr: PlanTransfer): Promise<void> => {
      if (guard.blockWrite()) return;
      setError(null);
      const write = settlementFor(
        groupId,
        tr,
        receivablesFor(toLedgerSnapshots(expenses.rows, group.data), tr.from, tr.to, tr.currency),
        // The ways to pay back follow the group's currency, not a country.
        defaultRailForCurrency(group.data?.default_currency ?? null),
      );
      if (!write) return;
      const out = await recordInline(lock, () => recordSettlement.mutateAsync(write));
      if (out === 'recorded') setRecorded((now) => new Set(now).add(keyOf(tr)));
      else if (out === 'failed') setError(s.settleFailed);
    },
    [groupId, expenses.rows, group.data, recordSettlement, guard, s.settleFailed],
  );

  if (group.isLoading || members.isLoading) {
    return <ActivityIndicator color={theme.color.brand} />;
  }
  const rows = [
    ...owedToMe.map((tr) => ({ tr, mine: 'receive' as const })),
    ...iOwe.map((tr) => ({ tr, mine: 'pay' as const })),
  ];
  const open = rows.filter(({ tr }) => !recorded.has(keyOf(tr)));

  return (
    <View
      style={{
        gap: theme.spacing.xs,
        padding: theme.spacing.md,
        borderRadius: theme.radius.lg,
        backgroundColor: theme.color.surface,
        borderWidth: 1,
        borderColor: theme.color.border,
      }}
    >
      <Text variant="subheading">{s.settleTitle}</Text>
      {open.length === 0 ? (
        <Text tone="muted">{s.settleAllDone}</Text>
      ) : (
        open.map(({ tr, mine }) => (
          <SettleRow
            key={keyOf(tr)}
            groupId={groupId}
            groupName={groupLabel(group.data, members.data ?? [], profile?.id)}
            joinToken={group.data?.join_token ?? null}
            transfer={tr}
            direction={mine}
            otherId={mine === 'receive' ? tr.from : tr.to}
            member={lookup.get(mine === 'receive' ? tr.from : tr.to)}
            name={nameOf(mine === 'receive' ? tr.from : tr.to)}
            amountText={fmt(tr.amount, tr.currency)}
            busy={recordSettlement.isPending}
            // The lock is read when the button is pressed, never while rendering.
            // eslint-disable-next-line react-hooks/refs
            onRecord={() => record(tr)}
          />
        ))
      )}
      {recorded.size > 0 ? (
        <Text
          variant="caption"
          style={{ color: theme.color.brand }}
          accessibilityLiveRegion="polite"
        >
          {s.settleRecorded}
        </Text>
      ) : null}
      {split.others.length > 0 ? (
        <Text variant="caption" tone="muted">
          {fill(s.settleOthers, { count: split.others.length })}
        </Text>
      ) : null}
      {error ? (
        <Text
          variant="caption"
          style={{ color: theme.color.negative }}
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function SettleRow({
  groupId,
  groupName,
  joinToken,
  transfer,
  direction,
  otherId,
  member,
  name,
  amountText,
  busy,
  onRecord,
}: {
  groupId: string;
  groupName: string;
  joinToken: string | null;
  transfer: PlanTransfer;
  direction: 'receive' | 'pay';
  otherId: string;
  member: MemberRow | undefined;
  name: string;
  amountText: string;
  busy: boolean;
  onRecord: () => Promise<void>;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const s = t.inline;
  const [asking, setAsking] = useState(false);
  const joined = Boolean(member && !isGhost(member));
  const remind = useRemind({
    groupId,
    memberId: otherId,
    currency: transfer.currency,
    joined,
    phone: member?.invite_phone ?? null,
    joinToken,
    name,
    groupName,
    amountText,
  });
  const row = owedRowModel({
    joined,
    hasMember: Boolean(member),
    left: hasLeft(member),
    pending: false,
    reminded: remind.reminded,
  });
  const receive = direction === 'receive';
  const line = fill(receive ? s.owesYou : s.youOwe, { name, amount: amountText });
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Text accessibilityLabel={line}>{line}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
        {receive && row.remind ? (
          <Button
            label={t.people.remind}
            variant="secondary"
            size="sm"
            accessibilityLabel={fill(t.misc.settleRemindA11y, { name, amount: amountText })}
            disabled={remind.pending}
            onPress={remind.open}
          />
        ) : null}
        <Button
          label={s.recordPayment}
          size="sm"
          accessibilityLabel={fill(s.recordA11y, { name, amount: amountText })}
          disabled={busy}
          onPress={() => setAsking(true)}
        />
      </View>
      {remind.sheet}
      <SettleConfirmSheet
        visible={asking}
        onClose={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          void onRecord();
        }}
        title={fill(receive ? t.misc.settleReceivedTitle : t.misc.settleConfirmPaidTitle, {
          amount: amountText,
          name,
        })}
        body={receive ? t.misc.settleConfirmReceivedBody : t.misc.settleConfirmPaidBody}
        avatar={
          <PersonAvatar
            name={name}
            member={member}
            ghost={member ? isGhost(member) : false}
            size={40}
          />
        }
        name={name}
        relation={receive ? t.misc.settleConfirmPaidYou : t.misc.settleConfirmYouPaid}
        amount={transfer.amount}
        currency={transfer.currency as CurrencyCode}
        confirmLabel={receive ? t.misc.settleReceivedConfirm : t.misc.settleConfirmPaidYes}
      />
    </View>
  );
}
