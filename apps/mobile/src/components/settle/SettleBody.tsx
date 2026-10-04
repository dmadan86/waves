/**
 * Settling up in a group, as plainly as it can be said: who owes me (remind
 * them), whom I owe (pay them), and nothing else until asked.
 *
 * Two homes: the Settle up screen (reached from a balance, a reminder, the
 * pending list) and a group's own Settle up tab, so the two cannot drift.
 *
 * Presentation only. The plan is the ledger's own (`useGroupLedger().transfers`,
 * simplified or pairwise as the group chose), reminders go through `useNudge`,
 * payments through the same hand-off + `useRecordSettlement` the screen has
 * always used (ADR-007: Waves records, it never moves money). Debts between
 * other members and the payment history sit behind one "See all balances" link.
 */

import { useMemo, useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Linking, Pressable, ScrollView, View } from 'react-native';

import {
  allocateSettlement,
  BalanceDirection,
  buildPaymentUri,
  defaultRailFor,
  format,
  money,
  railById,
  toMajorString,
  type CurrencyCode,
  type Receivable,
} from '@waves/core';
import {
  Avatar,
  Button,
  Callout,
  EmptyState,
  iconSize,
  MoneyText,
  Row,
  Text,
  useTheme,
  useScreenClearance,
} from '@waves/ui';

import { useBlockedUsers } from '@/data/blocked';
import {
  memberLookup,
  toSnapshot,
  useGroup,
  useGroupLedger,
  useRecordSettlement,
} from '@/data/hooks';
import {
  displayName,
  isBlockedMember,
  isGhost,
  payableAt,
  SettlementStatus,
  type MemberRow,
} from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { useAuth } from '@/lib/auth';
import { useDialog } from '@/lib/dialog';
import { useGuestGuard } from '@/lib/guestGuard';
import { router } from '@/lib/navigation';
import { useNudge } from '@/lib/nudge';
import { splitSettlePlan, summariseSettlePlan, type PlanTransfer } from '@/lib/settlePlan';

export function SettleBody({
  groupId,
  onRecorded,
}: {
  groupId: string;
  /**
   * What to do once a settlement is recorded. The screen closes itself; a
   * group's Settle up tab has nowhere to go back to, so it says where to look.
   */
  onRecorded?: () => void;
}) {
  const theme = useTheme();
  const clearance = useScreenClearance();
  const { t, locale } = useStrings();
  const { confirm } = useDialog();
  const { profile } = useAuth();
  const { blockedIds } = useBlockedUsers();

  const { group, members, expenses, settlements } = useGroup(groupId);
  const ledger = useGroupLedger(groupId, profile?.id ?? null);
  const recordSettlement = useRecordSettlement(groupId);
  const guard = useGuestGuard();

  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const currency = group.data?.default_currency ?? 'INR';
  const country = group.data?.country_code ?? null;
  const myMemberId = ledger.myMemberId;
  const lookup = useMemo(() => memberLookup(members.data), [members.data]);

  const split = useMemo(
    () => splitSettlePlan(ledger.transfers, myMemberId),
    [ledger.transfers, myMemberId],
  );
  const summary = useMemo(() => summariseSettlePlan(split, currency), [split, currency]);

  const nameOf = (memberId: string): string => {
    const member = lookup.get(memberId);
    return member ? displayName(member, null, blockedIds, t.misc.someone) : t.misc.someone;
  };
  const fmt = (value: bigint, code: string = currency): string =>
    format(money(value, code as CurrencyCode), { locale });

  /**
   * What the payer still owes the payee, expense by expense — the payment is
   * applied against these oldest-first (ADR-007).
   */
  const receivablesFor = (fromId: string, toId: string): Receivable[] =>
    expenses.rows
      .map(toSnapshot)
      .filter((snapshot): snapshot is NonNullable<typeof snapshot> => snapshot !== null)
      .map((snapshot) => {
        const owes = BigInt(snapshot.shares[fromId] ?? 0n);
        const paidByOther = BigInt(snapshot.payers[toId] ?? 0n);
        const portion = owes > 0n && paidByOther > 0n ? (owes * paidByOther) / snapshot.amount : 0n;
        return { expenseId: snapshot.id, date: snapshot.date, amount: portion };
      })
      .filter((receivable) => receivable.amount > 0n);

  /** Record one transfer of the plan as paid. The only write on this screen. */
  const record = async (transfer: PlanTransfer, rail: string): Promise<void> => {
    // A settlement is a write; an expired guest is read-only (ADR-006 addendum).
    if (guard.blockWrite()) return;
    if (transfer.amount <= 0n) return;
    setError(null);
    const receivables = receivablesFor(transfer.from, transfer.to);
    const allocation =
      receivables.length > 0
        ? allocateSettlement({ amount: transfer.amount }, receivables)
        : { allocations: [], unallocated: transfer.amount };
    try {
      await recordSettlement.mutateAsync({
        groupId,
        fromMemberId: transfer.from,
        toMemberId: transfer.to,
        amount: transfer.amount,
        rail,
        currency: transfer.currency,
        allocations: allocation.allocations,
      });
      if (onRecorded) onRecorded();
      else router.back();
    } catch (caught) {
      setError(friendlyError(caught, t.couldNotSave, 'settle.record'));
    }
  };

  /** Somebody paid me: ask before writing, it is easy to mis-tap a row. */
  const markReceived = async (transfer: PlanTransfer): Promise<void> => {
    const yes = await confirm({
      title: fill(t.misc.settleReceivedTitle, {
        amount: fmt(transfer.amount, transfer.currency),
        name: nameOf(transfer.from),
      }),
      body: t.misc.settleReceivedBody,
      confirmLabel: t.misc.settleReceivedConfirm,
      cancelLabel: t.misc.recordNo,
    });
    if (yes) void record(transfer, defaultRailFor(country));
  };

  /** I already paid, outside the app. */
  const markPaid = async (transfer: PlanTransfer): Promise<void> => {
    const yes = await confirm({
      title: fill(t.misc.settleMarkPaidTitle, {
        amount: fmt(transfer.amount, transfer.currency),
        name: nameOf(transfer.to),
      }),
      body: t.misc.settleMarkPaidBody,
      confirmLabel: t.misc.settleMarkPaidConfirm,
      cancelLabel: t.misc.recordNo,
    });
    if (yes) void record(transfer, defaultRailFor(country));
  };

  /**
   * Pay: hand off to their payment app if their saved rail has one, otherwise
   * show the handle to copy; with no details at all it is simply "record it".
   * Either way Waves never moves the money (ADR-007); it records that somebody
   * says they did.
   */
  const pay = async (transfer: PlanTransfer): Promise<void> => {
    const payee = lookup.get(transfer.to);
    const payable = payee ? payableAt(payee) : null;
    if (!payee || !payable) {
      await markPaid(transfer);
      return;
    }
    const railInfo = railById(payable.rail);
    const uri = buildPaymentUri(
      {
        railId: payable.rail,
        handle: payable.handle,
        payeeName: displayName(payee),
        amount: transfer.amount,
        currency: transfer.currency,
        note: `Waves ${group.data?.name ?? ''}`.trim(),
      },
      (value, code) => toMajorString({ minor: value, currency: code }),
    );
    // A custom scheme with nothing installed fails silently, so ask first; an
    // https link always opens (worst case a web page).
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
      if (paid) void record(transfer, payable.rail);
      return;
    }
    const recordIt = await confirm({
      title: t.misc.settlePayTitle.replace('{name}', displayName(payee)),
      body: t.misc.settlePayBody
        .replace('{rail}', railInfo?.label ?? t.misc.settleSendTo)
        .replace('{handle}', payable.handle),
      confirmLabel: t.misc.recordIt,
    });
    if (recordIt) void record(transfer, payable.rail);
  };

  if (group.isLoading || members.isLoading) {
    return (
      <View style={{ paddingTop: theme.spacing.xxxl, alignItems: 'center' }}>
        <ActivityIndicator color={theme.color.brand} />
      </View>
    );
  }

  const headline =
    summary.kind === 'settled'
      ? t.misc.settleSimpleSettled
      : summary.net > 0n
        ? fill(t.misc.settleSimpleOwed, { amount: fmt(summary.net) })
        : summary.net < 0n
          ? fill(t.misc.settleSimpleOwe, { amount: fmt(-summary.net) })
          : t.misc.settleSimpleEven;

  const history = (settlements.data ?? [])
    .filter((row) => row.status !== SettlementStatus.Cancelled)
    .slice()
    .sort((a, b) => b.initiated_at.localeCompare(a.initiated_at));

  const hasMore = split.others.length > 0 || history.length > 0;

  const personFor = (memberId: string): MemberRow | undefined => lookup.get(memberId);
  const ghostFor = (member: MemberRow | undefined): boolean =>
    Boolean(member && (isGhost(member) || isBlockedMember(member, blockedIds)));

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.lg,
          paddingBottom: clearance,
          gap: theme.spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text variant="heading" accessibilityRole="header">
          {headline}
        </Text>

        {summary.kind === 'settled' ? (
          <EmptyState
            title={t.allSettled}
            body={t.group.nobodyOwes}
            icon={
              <Ionicons name="checkmark-circle" size={iconSize.xxl} color={theme.color.positive} />
            }
          />
        ) : null}

        {error ? <Callout tone="negative">{error}</Callout> : null}

        {split.owesMe.length > 0 ? (
          <View>
            <Text variant="caption" tone="muted" accessibilityRole="header">
              {t.misc.settleOwesYou}
            </Text>
            {split.owesMe.map((transfer) => {
              const person = personFor(transfer.from);
              const name = nameOf(transfer.from);
              return (
                <PersonRow
                  key={`${transfer.from}-${transfer.currency}`}
                  name={name}
                  ghost={ghostFor(person)}
                  amount={transfer.amount}
                  currency={transfer.currency}
                  direction={BalanceDirection.OwedToYou}
                  locale={locale}
                  onPress={() => void markReceived(transfer)}
                  accessibilityLabel={`${name}. ${fmt(transfer.amount, transfer.currency)}`}
                  accessibilityHint={t.misc.settleReceivedHint}
                  action={
                    person && !isGhost(person) ? (
                      <RemindButton
                        groupId={groupId}
                        memberId={transfer.from}
                        currency={transfer.currency}
                        label={fill(t.misc.settleRemindA11y, {
                          name,
                          amount: fmt(transfer.amount, transfer.currency),
                        })}
                      />
                    ) : (
                      <Text variant="micro" tone="muted">
                        {t.notJoinedYet}
                      </Text>
                    )
                  }
                />
              );
            })}
          </View>
        ) : null}

        {split.iOwe.length > 0 ? (
          <View>
            <Text variant="caption" tone="muted" accessibilityRole="header">
              {t.misc.settleYouOweHeading}
            </Text>
            {split.iOwe.map((transfer) => {
              const person = personFor(transfer.to);
              const name = nameOf(transfer.to);
              const amountText = fmt(transfer.amount, transfer.currency);
              return (
                <PersonRow
                  key={`${transfer.to}-${transfer.currency}`}
                  name={name}
                  ghost={ghostFor(person)}
                  amount={transfer.amount}
                  currency={transfer.currency}
                  direction={BalanceDirection.YouOwe}
                  locale={locale}
                  accessibilityLabel={`${name}. ${amountText}`}
                  subAction={
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={fill(t.misc.settleMarkPaidA11y, {
                        name,
                        amount: amountText,
                      })}
                      disabled={recordSettlement.isPending}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      onPress={() => void markPaid(transfer)}
                    >
                      <Text variant="micro" tone="brand">
                        {t.misc.settleMarkPaid}
                      </Text>
                    </Pressable>
                  }
                  action={
                    <Button
                      label={t.misc.settlePay}
                      size="sm"
                      accessibilityLabel={fill(t.misc.settlePayA11y, { name, amount: amountText })}
                      disabled={recordSettlement.isPending}
                      onPress={() => void pay(transfer)}
                    />
                  }
                />
              );
            })}
          </View>
        ) : null}

        {recordSettlement.isPending ? <ActivityIndicator color={theme.color.brand} /> : null}

        {hasMore ? (
          <View>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showAll }}
              accessibilityLabel={showAll ? t.misc.settleHideAll : t.misc.settleSeeAll}
              onPress={() => setShowAll((open) => !open)}
              style={{ minHeight: 44, justifyContent: 'center' }}
            >
              <Row style={{ gap: theme.spacing.xs, alignItems: 'center' }}>
                <Text variant="caption" tone="brand">
                  {showAll ? t.misc.settleHideAll : t.misc.settleSeeAll}
                </Text>
                <Ionicons
                  name={showAll ? 'chevron-up' : 'chevron-down'}
                  size={iconSize.sm}
                  color={theme.color.brand}
                />
              </Row>
            </Pressable>

            {showAll ? (
              <View style={{ gap: theme.spacing.md }}>
                {split.others.length > 0 ? (
                  <View>
                    <Text variant="caption" tone="muted" accessibilityRole="header">
                      {t.misc.settleBetweenOthers}
                    </Text>
                    {split.others.map((transfer) => (
                      <PersonRow
                        key={`${transfer.from}-${transfer.to}-${transfer.currency}-${transfer.amount}`}
                        name={fill(t.simplifyPaysWhom, {
                          from: nameOf(transfer.from),
                          to: nameOf(transfer.to),
                        })}
                        ghost={ghostFor(personFor(transfer.from))}
                        avatarName={nameOf(transfer.from)}
                        amount={transfer.amount}
                        currency={transfer.currency}
                        direction={null}
                        locale={locale}
                      />
                    ))}
                  </View>
                ) : null}

                <View>
                  <Text variant="caption" tone="muted" accessibilityRole="header">
                    {t.misc.settleHistory}
                  </Text>
                  {history.length === 0 ? (
                    <Text
                      variant="caption"
                      tone="muted"
                      style={{ paddingVertical: theme.spacing.md }}
                    >
                      {t.misc.settleNoHistory}
                    </Text>
                  ) : (
                    history.map((row) => (
                      <PersonRow
                        key={row.id}
                        name={fill(t.misc.settleHistoryPaid, {
                          from: nameOf(row.from_member_id),
                          to: nameOf(row.to_member_id),
                        })}
                        ghost={ghostFor(personFor(row.from_member_id))}
                        avatarName={nameOf(row.from_member_id)}
                        amount={BigInt(row.amount)}
                        currency={row.currency}
                        direction={null}
                        locale={locale}
                      />
                    ))
                  )}
                </View>

                {/* The full who-pays-whom list is still one tap away. */}
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={t.whoPaysWhom}
                  onPress={() => router.push(`/group/${groupId}/simplify`)}
                  style={{ minHeight: 44, justifyContent: 'center' }}
                >
                  <Text variant="caption" tone="brand">
                    {t.whoPaysWhom}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/**
 * One compact line: avatar, name, amount, and at most one action. Held to a
 * 56pt floor so a short row is still a comfortable target. The row is one
 * control only when it has somewhere to go (`onPress`).
 */
function PersonRow({
  name,
  avatarName,
  ghost,
  amount,
  currency,
  direction,
  locale,
  action,
  subAction,
  onPress,
  accessibilityLabel,
  accessibilityHint,
}: {
  name: string;
  avatarName?: string;
  ghost: boolean;
  amount: bigint;
  currency: string;
  /** Null leaves the amount neutral (a payment between other people). */
  direction: BalanceDirection | null;
  locale: string;
  action?: ReactNode;
  subAction?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const theme = useTheme();
  const body = (
    <Row style={{ gap: theme.spacing.md, alignItems: 'center', minHeight: 56 }}>
      <Avatar name={avatarName ?? name} ghost={ghost} size={36} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="subheading" numberOfLines={2}>
          {name}
        </Text>
        {subAction ?? null}
      </View>
      <MoneyText
        amount={amount}
        currency={currency}
        locale={locale}
        mode={direction === null ? 'plain' : 'balance'}
        direction={direction ?? undefined}
      />
      {action ?? null}
    </Row>
  );

  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: theme.color.border }}>
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={accessibilityHint}
          onPress={onPress}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          {body}
        </Pressable>
      ) : (
        body
      )}
    </View>
  );
}

/**
 * The nudge: it goes once, and the server's one-a-day rule (ADR-010) reads as
 * "already nudged today" rather than as a failure.
 */
function RemindButton({
  groupId,
  memberId,
  currency,
  label,
}: {
  groupId: string;
  memberId: string;
  currency: string;
  label: string;
}) {
  const { t } = useStrings();
  const nudge = useNudge({ groupId, memberId, currency });
  const note = nudge.outcome?.label ?? null;

  if (note) {
    return (
      <Text variant="micro" tone="muted" style={{ maxWidth: 110 }}>
        {note}
      </Text>
    );
  }

  return (
    <Button
      label={t.people.remind}
      variant="secondary"
      size="sm"
      accessibilityLabel={label}
      disabled={nudge.pending}
      onPress={nudge.send}
    />
  );
}
