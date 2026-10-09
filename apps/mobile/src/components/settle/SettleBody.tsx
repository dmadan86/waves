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
  directionalIcon,
  iconSize,
  MoneyText,
  Row,
  Text,
  useTheme,
} from '@waves/ui';

import { useBlockedUsers } from '@/data/blocked';
import { useBottomClearance } from '@/lib/clearance';
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
  showSummary = true,
}: {
  groupId: string;
  /**
   * The Settle up screen opens with its own summary card; a group's tab sits
   * under the hero that already says what you are owed, so it leaves it out.
   */
  showSummary?: boolean;
  /**
   * What to do once a settlement is recorded. The screen closes itself; a
   * group's Settle up tab has nowhere to go back to, so it says where to look.
   */
  onRecorded?: () => void;
}) {
  const theme = useTheme();
  // The foot clears whatever is there: the app's tab bar when this is a
  // group's Settle up tab (the last "who pays whom" rows sat under it), the
  // system bar alone on the standalone Settle up screen.
  const clearance = useBottomClearance();
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
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterMember, setFilterMember] = useState<string | null>(null);

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

  // A payment someone has marked but the other side has not confirmed yet.
  const pendingPairs = new Set(
    (settlements.data ?? [])
      .filter((row) => row.status === SettlementStatus.Initiated)
      .map((row) => `${row.from_member_id}>${row.to_member_id}`),
  );

  // Members on either end of a payment between others: what the filter offers.
  const otherMembers = Array.from(
    new Set(split.others.flatMap((transfer) => [transfer.from, transfer.to])),
  );
  const shownOthers = filterMember
    ? split.others.filter(
        (transfer) => transfer.from === filterMember || transfer.to === filterMember,
      )
    : split.others;

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
        {showSummary ? <SummaryCard hero={hero} currency={currency} locale={locale} /> : null}

        {error ? <Callout tone="negative">{error}</Callout> : null}

        {split.owesMe.length > 0 ? (
          <Card>
            <CardHeader title={t.misc.settleOweYouTitle} subtitle={t.misc.settleClearBalanceSub} />
            {split.owesMe.map((transfer) => {
              const person = personFor(transfer.from);
              const name = nameOf(transfer.from);
              const joined = Boolean(person && !isGhost(person));
              return (
                <PersonTile
                  key={`${transfer.from}-${transfer.currency}`}
                  name={name}
                  member={person}
                  ghost={ghostFor(person)}
                  status={
                    !joined
                      ? t.notJoinedYet
                      : pendingPairs.has(`${transfer.from}>${transfer.to}`)
                        ? t.misc.settleStatusPending
                        : null
                  }
                  amount={transfer.amount}
                  currency={transfer.currency}
                  direction={BalanceDirection.OwedToYou}
                  locale={locale}
                  // The row has always been the way to say "they paid me".
                  accessibilityLabel={`${name}. ${t.misc.settleReceivedHint}`}
                  onPress={() => void markReceived(transfer)}
                  disabled={recordSettlement.isPending}
                  action={
                    joined ? (
                      <RemindButton
                        groupId={groupId}
                        memberId={transfer.from}
                        currency={transfer.currency}
                        label={fill(t.misc.settleRemindA11y, {
                          name,
                          amount: fmt(transfer.amount, transfer.currency),
                        })}
                      />
                    ) : null
                  }
                />
              );
            })}
          </Card>
        ) : null}

        {split.iOwe.length > 0 ? (
          <Card>
            <CardHeader title={t.misc.settleYouOweTitle} subtitle={t.misc.settleClearBalanceSub} />
            {split.iOwe.map((transfer) => {
              const person = personFor(transfer.to);
              const name = nameOf(transfer.to);
              const amountText = fmt(transfer.amount, transfer.currency);
              return (
                <PersonTile
                  key={`${transfer.to}-${transfer.currency}`}
                  name={name}
                  member={person}
                  ghost={ghostFor(person)}
                  status={
                    !person || isGhost(person)
                      ? t.notJoinedYet
                      : pendingPairs.has(`${transfer.from}>${transfer.to}`)
                        ? t.misc.settleStatusPending
                        : null
                  }
                  amount={transfer.amount}
                  currency={transfer.currency}
                  direction={BalanceDirection.YouOwe}
                  locale={locale}
                  // Already paid outside the app: the row records it, the
                  // button hands off to their payment app.
                  accessibilityLabel={fill(t.misc.settleMarkPaidA11y, { name, amount: amountText })}
                  onPress={() => void markPaid(transfer)}
                  disabled={recordSettlement.isPending}
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
          </Card>
        ) : null}

        {recordSettlement.isPending ? <ActivityIndicator color={theme.color.brand} /> : null}

        {split.others.length > 0 ? (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm }}>
              <View style={{ flex: 1 }}>
                <CardHeader
                  title={t.misc.settleBetweenOthers}
                  subtitle={t.misc.settleBetweenOthersSub}
                />
              </View>
              <FilterPill
                label={filterMember ? nameOf(filterMember) : t.misc.settleFilterAll}
                onPress={() => setFilterOpen((open) => !open)}
                open={filterOpen}
              />
            </View>
            {filterOpen ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                {[null, ...otherMembers].map((id) => (
                  <FilterChip
                    key={id ?? 'all'}
                    label={id ? nameOf(id) : t.misc.settleFilterAll}
                    selected={id === filterMember}
                    onPress={() => {
                      setFilterMember(id);
                      setFilterOpen(false);
                    }}
                  />
                ))}
              </View>
            ) : null}
            {shownOthers.map((transfer) => (
              <OtherTile
                key={`${transfer.from}-${transfer.to}-${transfer.currency}-${transfer.amount}`}
                fromName={nameOf(transfer.from)}
                toName={nameOf(transfer.to)}
                from={personFor(transfer.from)}
                to={personFor(transfer.to)}
                fromGhost={ghostFor(personFor(transfer.from))}
                toGhost={ghostFor(personFor(transfer.to))}
                amount={transfer.amount}
                currency={transfer.currency}
                locale={locale}
              />
            ))}
          </Card>
        ) : null}

        <Card>
          <Pressable
            accessibilityRole={historyExpandable ? 'button' : undefined}
            accessibilityState={historyExpandable ? { expanded: showAllHistory } : undefined}
            disabled={!historyExpandable}
            onPress={() => setShowAllHistory((open) => !open)}
          >
            <Row style={{ gap: theme.spacing.md, alignItems: 'center', minHeight: 56 }}>
              <Ionicons name="time-outline" size={iconSize.xxl} color={theme.color.brand} />
              <View style={{ flex: 1 }}>
                <Text variant="subheading" accessibilityRole="header">
                  {t.misc.settleHistory}
                </Text>
                {history.length === 0 ? (
                  <>
                    <Text variant="body" tone="muted">
                      {t.misc.settleNoHistory}
                    </Text>
                    <Text variant="caption" tone="muted">
                      {t.misc.settleNoHistorySub}
                    </Text>
                  </>
                ) : (
                  <Text variant="caption" tone="muted">
                    {plural(locale, history.length, t.misc.settlePaymentsCount)}
                  </Text>
                )}
              </View>
              {history.length === 0 ? (
                <Image
                  source={HISTORY_ART}
                  style={{ width: 72, height: 40 }}
                  resizeMode="contain"
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
              ) : null}
              <Ionicons
                name={
                  historyExpandable
                    ? showAllHistory
                      ? 'chevron-up'
                      : 'chevron-down'
                    : directionalIcon('chevron-forward')
                }
                size={iconSize.md}
                color={theme.color.textMuted}
              />
            </Row>
          </Pressable>
          {shownHistory.map((row) => (
            <OtherTile
              key={row.id}
              fromName={nameOf(row.from_member_id)}
              toName={nameOf(row.to_member_id)}
              from={personFor(row.from_member_id)}
              to={personFor(row.to_member_id)}
              fromGhost={ghostFor(personFor(row.from_member_id))}
              toGhost={ghostFor(personFor(row.to_member_id))}
              amount={BigInt(row.amount)}
              currency={row.currency}
              locale={locale}
              date={row.initiated_at}
            />
          ))}
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
          // Tiles sit 8pt apart, the compact rhythm the design uses.
          gap: theme.spacing.sm,
        },
        theme.shadow.soft,
      ]}
    >
      {children}
    </View>
  );
}

function CardHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={{ paddingBottom: 8 }}>
      <Text variant="heading" accessibilityRole="header">
        {title}
      </Text>
      <Text variant="caption" tone="muted">
        {subtitle}
      </Text>
    </View>
  );
}

/** The light rounded tile each person or payment sits on inside a card. */
function Tile({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.color.surfaceMuted,
        borderRadius: theme.radius.md,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        minHeight: 56,
        justifyContent: 'center',
      }}
    >
      {children}
    </View>
  );
}

/** An avatar that resolves the member's photo itself (a hook cannot run in a map). */
function MemberAvatar({
  name,
  member,
  ghost,
  size,
}: {
  name: string;
  member?: MemberRow;
  ghost: boolean;
  size: number;
}) {
  const photoUrl = useAvatarUrl(member?.profile?.avatar_url);
  return <Avatar name={name} ghost={ghost} photoUrl={photoUrl} size={size} />;
}

/**
 * The compact "All ⌄" pill. The filter is by member: every payment that
 * member is on either end of.
 */
function FilterPill({
  label,
  open,
  onPress,
}: {
  label: string;
  open: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: open }}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.xs,
        maxWidth: 140,
        height: 34,
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radius.pill,
        backgroundColor: theme.color.brandSoft,
      }}
    >
      <Text variant="caption" tone="brand" numberOfLines={1} style={{ flexShrink: 1 }}>
        {label}
      </Text>
      <Ionicons
        name={open ? 'chevron-up' : 'chevron-down'}
        size={iconSize.sm}
        color={theme.color.brand}
      />
    </Pressable>
  );
}

function FilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        paddingHorizontal: theme.spacing.md,
        height: 32,
        justifyContent: 'center',
        borderRadius: theme.radius.pill,
        backgroundColor: selected ? theme.color.brand : theme.color.surfaceMuted,
      }}
    >
      <Text variant="caption" tone={selected ? 'onBrand' : 'default'} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * One person on a settle row: avatar, name with a muted status line, amount,
 * and at most one action. The row itself keeps its old job (mark as
 * received / paid) so the new buttons add to it rather than replace it.
 */
function PersonTile({
  name,
  member,
  ghost,
  status,
  amount,
  currency,
  direction,
  locale,
  action,
  onPress,
  disabled,
  accessibilityLabel,
}: {
  name: string;
  member?: MemberRow;
  ghost: boolean;
  status: string | null;
  amount: bigint;
  currency: string;
  direction: BalanceDirection;
  locale: string;
  action: ReactNode;
  onPress: () => void;
  disabled: boolean;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <Tile>
        <Row style={{ gap: theme.spacing.md, alignItems: 'center' }}>
          <MemberAvatar name={name} member={member} ghost={ghost} size={40} />
          <View style={{ flex: 1 }}>
            <Text variant="subheading" numberOfLines={1}>
              {name}
            </Text>
            {status ? (
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {status}
              </Text>
            ) : null}
          </View>
          <MoneyText
            amount={amount}
            currency={currency as CurrencyCode}
            locale={locale}
            mode="balance"
            direction={direction}
            // Money owed to me wears the brand colour, as the design has it;
            // money I owe keeps the red the rest of the app reads as "out".
            tone={direction === BalanceDirection.OwedToYou ? 'brand' : undefined}
          />
          {action}
        </Row>
      </Tile>
    </Pressable>
  );
}

/**
 * A payment between two members: who, an arrow, whom, and the amount with its
 * date beneath when the payment has one (a recorded payment does; a planned
 * transfer is computed and has none).
 */
function OtherTile({
  fromName,
  toName,
  from,
  to,
  fromGhost,
  toGhost,
  amount,
  currency,
  locale,
  date,
}: {
  fromName: string;
  toName: string;
  from?: MemberRow;
  to?: MemberRow;
  fromGhost: boolean;
  toGhost: boolean;
  amount: bigint;
  currency: string;
  locale: string;
  date?: string;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <Tile>
      <Row
        accessible
        accessibilityLabel={fill(t.simplifyPaysWhom, { from: fromName, to: toName })}
        style={{ gap: theme.spacing.md, alignItems: 'center' }}
      >
        {/* The pair, overlapped, and the names stacked beside them: the payer
            on the first line, "→ receiver" on the second. Two names side by
            side squeezed each into a third of the row, and a long one
            ("Rvs R Deepak") was cut to nothing; stacked, each gets the full
            width of the text column. */}
        <View style={{ flexDirection: 'row' }}>
          <MemberAvatar name={fromName} member={from} ghost={fromGhost} size={30} />
          <View
            style={{
              marginStart: -8,
              borderRadius: 17,
              borderWidth: 2,
              borderColor: theme.color.surfaceMuted,
            }}
          >
            <MemberAvatar name={toName} member={to} ghost={toGhost} size={30} />
          </View>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="body" numberOfLines={1} style={{ fontWeight: '600' }}>
            {fromName}
          </Text>
          <Row style={{ gap: 4, alignItems: 'center' }}>
            <Ionicons
              name={directionalIcon('arrow-forward')}
              size={iconSize.sm}
              color={theme.color.brand}
            />
            <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
              {toName}
            </Text>
          </Row>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <MoneyText
            amount={amount}
            currency={currency as CurrencyCode}
            locale={locale}
            variant="body"
            mode="plain"
          />
          {date ? (
            <Text variant="micro" tone="muted">
              {new Date(date).toLocaleDateString(locale, {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </Text>
          ) : null}
        </View>
      </Row>
    </Tile>
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
  const theme = useTheme();
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
      icon={
        <Ionicons name="notifications-outline" size={iconSize.base} color={theme.color.brand} />
      }
      accessibilityLabel={label}
      disabled={nudge.pending}
      onPress={nudge.send}
    />
  );
}
