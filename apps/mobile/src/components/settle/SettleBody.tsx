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
 * other members, the payment history and the who-pays-whom view sit below.
 */

import { useMemo, useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, View } from 'react-native';

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
import { useAvatarUrl } from '@/components/ProfileAvatar';
import { fill, plural, useStrings } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { useAuth } from '@/lib/auth';
import { useDialog } from '@/lib/dialog';
import { useGuestGuard } from '@/lib/guestGuard';
import { router } from '@/lib/navigation';
import { useNudge } from '@/lib/nudge';
import {
  settleHero,
  splitSettlePlan,
  summariseSettlePlan,
  type PlanTransfer,
  type SettleHero,
} from '@/lib/settlePlan';

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
  const [showAllHistory, setShowAllHistory] = useState(false);

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

  const hero = settleHero(split, summary, currency);

  const history = (settlements.data ?? [])
    .filter((row) => row.status !== SettlementStatus.Cancelled)
    .slice()
    .sort((a, b) => b.initiated_at.localeCompare(a.initiated_at));
  const shownHistory = showAllHistory ? history : history.slice(0, HISTORY_PREVIEW);
  const historyExpandable = history.length > HISTORY_PREVIEW;

  const personFor = (memberId: string): MemberRow | undefined => lookup.get(memberId);
  const ghostFor = (member: MemberRow | undefined): boolean =>
    Boolean(member && (isGhost(member) || isBlockedMember(member, blockedIds)));

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.md,
          paddingBottom: clearance,
          gap: GAP,
        }}
        showsVerticalScrollIndicator={false}
      >
        <SummaryCard hero={hero} currency={currency} locale={locale} />

        {error ? <Callout tone="negative">{error}</Callout> : null}

        {split.owesMe.length + split.iOwe.length > 0 ? (
          <Card>
            <CardHeader title={t.misc.settleYourPayments} subtitle={t.misc.settleYourPaymentsSub} />
            {split.iOwe.map((transfer) => {
              const person = personFor(transfer.to);
              const name = nameOf(transfer.to);
              const amountText = fmt(transfer.amount, transfer.currency);
              return (
                <PersonRow
                  key={`${transfer.to}-${transfer.currency}`}
                  name={name}
                  member={person}
                  ghost={ghostFor(person)}
                  amount={transfer.amount}
                  currency={transfer.currency}
                  direction={BalanceDirection.YouOwe}
                  locale={locale}
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
                      <Text variant="caption" tone="brand">
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
            {split.owesMe.map((transfer) => {
              const person = personFor(transfer.from);
              const name = nameOf(transfer.from);
              return (
                <PersonRow
                  key={`${transfer.from}-${transfer.currency}`}
                  name={name}
                  member={person}
                  ghost={ghostFor(person)}
                  amount={transfer.amount}
                  currency={transfer.currency}
                  direction={BalanceDirection.OwedToYou}
                  locale={locale}
                  subAction={
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${name}. ${t.misc.settleReceivedHint}`}
                      disabled={recordSettlement.isPending}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      onPress={() => void markReceived(transfer)}
                    >
                      <Text variant="caption" tone="brand">
                        {t.misc.settleReceivedConfirm}
                      </Text>
                    </Pressable>
                  }
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
          </Card>
        ) : null}

        {recordSettlement.isPending ? <ActivityIndicator color={theme.color.brand} /> : null}

        {split.others.length > 0 ? (
          <Card>
            <CardHeader
              title={t.misc.settleBetweenOthers}
              subtitle={t.misc.settleBetweenOthersSub}
            />
            {split.others.map((transfer) => {
              const payer = personFor(transfer.from);
              return (
                <PersonRow
                  key={`${transfer.from}-${transfer.to}-${transfer.currency}-${transfer.amount}`}
                  name={fill(t.simplifyPaysWhom, {
                    from: nameOf(transfer.from),
                    to: nameOf(transfer.to),
                  })}
                  member={payer}
                  avatarName={nameOf(transfer.from)}
                  ghost={ghostFor(payer)}
                  amount={transfer.amount}
                  currency={transfer.currency}
                  direction={null}
                  locale={locale}
                />
              );
            })}
          </Card>
        ) : null}

        <Card>
          <Pressable
            accessibilityRole={historyExpandable ? 'button' : undefined}
            accessibilityState={historyExpandable ? { expanded: showAllHistory } : undefined}
            disabled={!historyExpandable}
            onPress={() => setShowAllHistory((open) => !open)}
          >
            <Row style={{ gap: theme.spacing.md, alignItems: 'center', minHeight: 48 }}>
              <Ionicons name="time-outline" size={iconSize.xxl} color={theme.color.text} />
              <View style={{ flex: 1 }}>
                <Text variant="subheading" accessibilityRole="header">
                  {t.misc.settleHistory}
                </Text>
                {history.length === 0 ? (
                  <Text variant="caption" tone="muted">
                    {t.misc.settleNoHistory}
                  </Text>
                ) : null}
              </View>
              {history.length === 0 ? (
                <Image
                  source={HISTORY_ART}
                  style={{ width: 88, height: 45 }}
                  resizeMode="contain"
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
              ) : historyExpandable ? (
                <Ionicons
                  name={showAllHistory ? 'chevron-up' : 'chevron-down'}
                  size={iconSize.md}
                  color={theme.color.textMuted}
                />
              ) : null}
            </Row>
          </Pressable>
          {shownHistory.map((row) => {
            const payer = personFor(row.from_member_id);
            return (
              <PersonRow
                key={row.id}
                name={fill(t.misc.settleHistoryPaid, {
                  from: nameOf(row.from_member_id),
                  to: nameOf(row.to_member_id),
                })}
                member={payer}
                ghost={ghostFor(payer)}
                avatarName={nameOf(row.from_member_id)}
                amount={BigInt(row.amount)}
                currency={row.currency}
                direction={null}
                locale={locale}
              />
            );
          })}
        </Card>

        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t.whoPaysWhom}
          onPress={() => router.push(`/group/${groupId}/simplify`)}
          style={({ pressed }) => [
            {
              backgroundColor: theme.color.surface,
              borderRadius: theme.radius.lg,
              paddingHorizontal: theme.spacing.md,
              minHeight: 52,
              justifyContent: 'center',
              opacity: pressed ? 0.7 : 1,
            },
            theme.shadow.soft,
          ]}
        >
          <Row style={{ gap: theme.spacing.md, alignItems: 'center' }}>
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: theme.color.brandSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="stats-chart" size={iconSize.base} color={theme.color.brand} />
            </View>
            <Text variant="subheading" tone="brand" style={{ flex: 1 }}>
              {t.whoPaysWhom}
            </Text>
            <Ionicons name="chevron-forward" size={iconSize.md} color={theme.color.textMuted} />
          </Row>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const GAP = 10;
const HISTORY_PREVIEW = 3;
const WALLET_ART = require('../../../assets/images/settle-wallet.webp') as number;
const HISTORY_ART = require('../../../assets/images/settle-history.webp') as number;

/** A white card: the one surface every block below the summary sits on. */
function Card({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: theme.color.surface,
          borderRadius: theme.radius.lg,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.md,
        },
        theme.shadow.soft,
      ]}
    >
      {children}
    </View>
  );
}

function CardHeader({ title, subtitle }: { title: string; subtitle: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingBottom: theme.spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: theme.color.border,
      }}
    >
      <Text variant="subheading" accessibilityRole="header">
        {title}
      </Text>
      <Text variant="caption" tone="muted">
        {subtitle}
      </Text>
    </View>
  );
}

/**
 * The top card: which side of the ledger I am on, the amount, and how many
 * payments make it up. A soft wash of the money colours (never the saturated
 * balance panel) with the wallet on the right.
 */
function SummaryCard({
  hero,
  currency,
  locale,
}: {
  hero: SettleHero;
  currency: string;
  locale: string;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const colors: [string, string] =
    hero.tone === 'owe'
      ? [theme.color.negativeSoft, theme.color.brandSoft]
      : hero.tone === 'owed'
        ? [theme.color.positiveSoft, theme.tint.sky.bg]
        : [theme.color.surfaceMuted, theme.color.brandSoft];

  return (
    <LinearGradient
      colors={colors}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        borderRadius: theme.radius.lg,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.md,
        minHeight: 96,
        overflow: 'hidden',
        justifyContent: 'center',
      }}
    >
      <Image
        source={WALLET_ART}
        style={{ position: 'absolute', right: 8, bottom: 4, width: 132, height: 70 }}
        resizeMode="contain"
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      {hero.tone === 'settled' ? (
        <Text variant="title" accessibilityRole="header">
          {t.allSettled}
        </Text>
      ) : (
        <View accessible accessibilityRole="header">
          <Text variant="body" tone="muted">
            {hero.tone === 'owe' ? t.youOwe : t.youAreOwed}
          </Text>
          <MoneyText
            amount={hero.amount}
            currency={currency as CurrencyCode}
            locale={locale}
            variant="display"
            mode="balance"
            direction={hero.tone === 'owe' ? BalanceDirection.YouOwe : BalanceDirection.OwedToYou}
          />
          <Text variant="caption" tone="muted">
            {plural(locale, hero.count, t.misc.settlePaymentsCount)}
          </Text>
        </View>
      )}
    </LinearGradient>
  );
}

/**
 * One compact line: avatar, name, amount, and at most one action. Held to a
 * 56pt floor so a short row is still a comfortable target.
 */
function PersonRow({
  name,
  avatarName,
  member,
  ghost,
  amount,
  currency,
  direction,
  locale,
  action,
  subAction,
}: {
  name: string;
  avatarName?: string;
  member?: MemberRow;
  ghost: boolean;
  amount: bigint;
  currency: string;
  /** Null leaves the amount neutral (a payment between other people). */
  direction: BalanceDirection | null;
  locale: string;
  action?: ReactNode;
  subAction?: ReactNode;
}) {
  const theme = useTheme();
  const photoUrl = useAvatarUrl(member?.profile?.avatar_url);
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: theme.color.border }}>
      <Row style={{ gap: theme.spacing.md, alignItems: 'center', minHeight: 56 }}>
        <Avatar name={avatarName ?? name} ghost={ghost} photoUrl={photoUrl} size={40} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="subheading" numberOfLines={2}>
            {name}
          </Text>
          {subAction ?? null}
        </View>
        <MoneyText
          amount={amount}
          currency={currency as CurrencyCode}
          locale={locale}
          mode={direction === null ? 'plain' : 'balance'}
          direction={direction ?? undefined}
        />
        {action ?? null}
      </Row>
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
      size="sm"
      accessibilityLabel={label}
      disabled={nudge.pending}
      onPress={nudge.send}
    />
  );
}
