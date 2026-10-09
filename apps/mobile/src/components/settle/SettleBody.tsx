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
  toLedgerSnapshots,
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
import { dateTimeFormat } from '@/lib/dateTimeFormat';
import { friendlyError } from '@/lib/errors';
import { useAuth } from '@/lib/auth';
import { useDialog } from '@/lib/dialog';
import { useGuestGuard } from '@/lib/guestGuard';
import { router } from '@/lib/navigation';
import { useNudge } from '@/lib/nudge';
import { convertedCaption, isRatelessTransfer } from '@/lib/settleCurrency';
import { useAddRate } from '@/lib/useAddRate';
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
  const { confirm, notify } = useDialog();
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

  const converts = ledger.convertsToGroupCurrency;
  /** A debt from a bill with no rate yet, in a group that settles in its own
   *  currency: not payable here (the server takes only the group currency), so
   *  the row offers to add the rate instead. */
  const rateless = (transfer: PlanTransfer): boolean =>
    isRatelessTransfer(transfer, currency, converts);
  const addRate = useAddRate(groupId);

  /**
   * What the payer still owes the payee, expense by expense — the payment is
   * applied against these oldest-first (ADR-007). Read off the bills as the
   * balances count them (a converted ₫ bill in the group's currency) and only in
   * the settlement's own currency, so an allocation never mixes units.
   */
  const receivablesFor = (fromId: string, toId: string, code: string): Receivable[] =>
    toLedgerSnapshots(expenses.rows, group.data)
      .filter((snapshot) => !snapshot.deletedAt && snapshot.currency === code)
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
    // Never record a rate-less debt: the server refuses anything but the group
    // currency in a converting group. The rows never offer it; this is the floor.
    if (rateless(transfer)) return;
    setError(null);
    const receivables = receivablesFor(transfer.from, transfer.to, transfer.currency);
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

  /** A payment already marked and waiting on the other side: say so, record nothing. */
  const explainPending = async (): Promise<void> => {
    await notify({ title: t.misc.settlePendingTitle, body: t.misc.settlePendingBody });
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
  const heroCaption = convertedCaption(ledger.convertedFrom, locale, t.fx.convertedCaption);

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
      .map((row) => `${row.from_member_id}>${row.to_member_id}>${row.currency}`),
  );
  const isPending = (transfer: PlanTransfer): boolean =>
    pendingPairs.has(`${transfer.from}>${transfer.to}>${transfer.currency}`);

  // Members on either end of a payment between others: what the filter offers.
  const otherMembers = Array.from(
    new Set(split.others.flatMap((transfer) => [transfer.from, transfer.to])),
  );
  // A member who has dropped out of the list (their debts settled) cannot
  // stay selected, or the list would be empty with no way to see why.
  const activeFilter = filterMember && otherMembers.includes(filterMember) ? filterMember : null;
  const shownOthers = activeFilter
    ? split.others.filter(
        (transfer) => transfer.from === activeFilter || transfer.to === activeFilter,
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
        {showSummary ? (
          <SummaryCard hero={hero} currency={currency} locale={locale} caption={heroCaption} />
        ) : null}

        {error ? <Callout tone="negative">{error}</Callout> : null}

        {split.owesMe.length > 0 ? (
          <Card>
            <CardHeader title={t.misc.settleOweYouTitle} />
            {split.owesMe.map((transfer) => {
              const person = personFor(transfer.from);
              const name = nameOf(transfer.from);
              const joined = Boolean(person && !isGhost(person));
              if (rateless(transfer)) {
                return (
                  <RatelessTile
                    key={`${transfer.from}-${transfer.currency}`}
                    name={name}
                    member={person}
                    ghost={ghostFor(person)}
                    amount={transfer.amount}
                    currency={transfer.currency}
                    direction={BalanceDirection.OwedToYou}
                    locale={locale}
                    onAddRate={() =>
                      void addRate({
                        currency: transfer.currency,
                        parties: [transfer.from, transfer.to],
                      })
                    }
                  />
                );
              }
              return (
                <PersonTile
                  key={`${transfer.from}-${transfer.currency}`}
                  name={name}
                  member={person}
                  ghost={ghostFor(person)}
                  status={
                    !joined
                      ? t.notJoinedYet
                      : isPending(transfer)
                        ? t.misc.settleStatusPending
                        : null
                  }
                  hint={t.misc.settleTapReceived}
                  amount={transfer.amount}
                  currency={transfer.currency}
                  direction={BalanceDirection.OwedToYou}
                  locale={locale}
                  // The row has always been the way to say "they paid me".
                  accessibilityLabel={`${name}. ${t.misc.settleReceivedHint}`}
                  onPress={() =>
                    void (isPending(transfer) ? explainPending() : markReceived(transfer))
                  }
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
            <CardHeader title={t.misc.settleYouOweTitle} />
            {split.iOwe.map((transfer) => {
              const person = personFor(transfer.to);
              const name = nameOf(transfer.to);
              const amountText = fmt(transfer.amount, transfer.currency);
              if (rateless(transfer)) {
                return (
                  <RatelessTile
                    key={`${transfer.to}-${transfer.currency}`}
                    name={name}
                    member={person}
                    ghost={ghostFor(person)}
                    amount={transfer.amount}
                    currency={transfer.currency}
                    direction={BalanceDirection.YouOwe}
                    locale={locale}
                    onAddRate={() =>
                      void addRate({
                        currency: transfer.currency,
                        parties: [transfer.from, transfer.to],
                      })
                    }
                  />
                );
              }
              return (
                <PersonTile
                  key={`${transfer.to}-${transfer.currency}`}
                  name={name}
                  member={person}
                  ghost={ghostFor(person)}
                  status={
                    !person || isGhost(person)
                      ? t.notJoinedYet
                      : isPending(transfer)
                        ? t.misc.settleStatusPending
                        : null
                  }
                  hint={t.misc.settleTapPaid}
                  amount={transfer.amount}
                  currency={transfer.currency}
                  direction={BalanceDirection.YouOwe}
                  locale={locale}
                  // Already paid outside the app: the row records it, the
                  // button hands off to their payment app.
                  accessibilityLabel={fill(t.misc.settleMarkPaidA11y, { name, amount: amountText })}
                  onPress={() => void (isPending(transfer) ? explainPending() : markPaid(transfer))}
                  disabled={recordSettlement.isPending}
                  action={
                    <PayPill
                      label={t.misc.settlePay}
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
                label={activeFilter ? nameOf(activeFilter) : t.misc.settleFilterAll}
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
                    selected={id === activeFilter}
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
          {/* One line when empty (clock, title, muted "No payments yet"): the
              old illustration and sentence spent 120pt on nothing. */}
          <Row style={{ gap: theme.spacing.sm, alignItems: 'center', minHeight: 24 }}>
            <Ionicons name="time-outline" size={iconSize.lg} color={theme.color.brand} />
            <Text variant="subheading" accessibilityRole="header">
              {t.misc.settleHistory}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
              {history.length === 0
                ? t.misc.settleNoHistory
                : plural(locale, history.length, t.misc.settlePaymentsCount)}
            </Text>
          </Row>
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
              past
            />
          ))}
          {historyExpandable ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showAllHistory }}
              hitSlop={{ top: 8, bottom: 8 }}
              onPress={() => setShowAllHistory((open) => !open)}
              style={{ alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center' }}
            >
              <Text variant="caption" tone="brand">
                {showAllHistory ? t.misc.settleHideAll : t.misc.settleSeeAll}
              </Text>
              <Ionicons
                name={showAllHistory ? 'chevron-up' : directionalIcon('chevron-forward')}
                size={iconSize.sm}
                color={theme.color.brand}
              />
            </Pressable>
          ) : null}
        </Card>

        {/* A slim text link, not a card: it is a way out, not content. */}
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t.whoPaysWhom}
          onPress={() => router.push(`/group/${groupId}/simplify`)}
          style={({ pressed }) => ({
            minHeight: 44,
            paddingHorizontal: theme.spacing.xs,
            justifyContent: 'center',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Row style={{ gap: theme.spacing.sm, alignItems: 'center' }}>
            <Ionicons name="stats-chart" size={iconSize.base} color={theme.color.brand} />
            <Text variant="body" tone="brand" style={{ flex: 1 }}>
              {t.whoPaysWhom}
            </Text>
            <Ionicons
              name={directionalIcon('chevron-forward')}
              size={iconSize.md}
              color={theme.color.textMuted}
            />
          </Row>
        </Pressable>
      </ScrollView>
    </View>
  );
}

// Cards sit 8pt apart: this screen is a checklist, not a showcase.
const GAP = 8;
const HISTORY_PREVIEW = 3;
const WALLET_ART = require('../../../assets/images/settle-wallet.webp') as number;

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

/** The card's title; the optional subtitle is only for copy that changes what a row means. */
function CardHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View>
      <Text variant="subheading" accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? (
        <Text variant="caption" tone="muted">
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A compact Pay pill. The shared Button's smallest size is 38pt, which made
 * the row taller than its avatar; this keeps the same primary look
 * (`buttonPrimary`, as the confirm sheet's button uses) at 32pt.
 */
function PayPill({
  label,
  accessibilityLabel,
  disabled,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        height: 32,
        paddingHorizontal: theme.spacing.lg,
        borderRadius: theme.radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? theme.color.buttonPrimaryPressed : theme.color.buttonPrimary,
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <Text variant="caption" tone="onBrand" numberOfLines={1} style={{ fontWeight: '700' }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** The light rounded tile each person or payment sits on inside a card. */
function Tile({ children, dense = false }: { children: ReactNode; dense?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.color.surfaceMuted,
        borderRadius: theme.radius.md,
        paddingHorizontal: theme.spacing.md,
        // Dense (payments, no action button) rows land at 48pt; people rows
        // keep 56pt, the height of their 40pt avatar plus padding.
        paddingVertical: dense ? theme.spacing.xs : theme.spacing.sm,
        minHeight: dense ? 48 : 56,
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
  hint,
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
  /** Shown in the status line when there is no status: what a tap does. */
  hint: string;
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
  // The tappable part and the action are siblings: nesting a button inside a
  // button hides the inner one from a screen reader.
  return (
    <Tile>
      <Row style={{ gap: theme.spacing.md, alignItems: 'center' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          disabled={disabled}
          onPress={onPress}
          style={({ pressed }) => ({
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.md,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <MemberAvatar name={name} member={member} ghost={ghost} size={40} />
          <View style={{ flex: 1 }}>
            <Text variant="subheading" numberOfLines={1}>
              {name}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {status ?? hint}
            </Text>
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
        </Pressable>
        {action}
      </Row>
    </Tile>
  );
}

/**
 * A debt from a bill that has no rate yet, in a group that settles in its own
 * currency. It still shows (the debt is real, in the bill's own currency), but
 * it cannot be paid, marked or reminded about until the bill has a rate — then
 * it joins the group-currency total above. The one action is to add that rate.
 */
function RatelessTile({
  name,
  member,
  ghost,
  amount,
  currency,
  direction,
  locale,
  onAddRate,
}: {
  name: string;
  member?: MemberRow;
  ghost: boolean;
  amount: bigint;
  currency: string;
  direction: BalanceDirection;
  locale: string;
  onAddRate: () => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <Tile>
      <Row style={{ gap: theme.spacing.md, alignItems: 'center' }}>
        <View
          accessible
          accessibilityLabel={`${name}. ${t.fx.noRateYet}`}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}
        >
          <MemberAvatar name={name} member={member} ghost={ghost} size={40} />
          <View style={{ flex: 1 }}>
            <Text variant="subheading" numberOfLines={1}>
              {name}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {t.fx.noRateYet}
            </Text>
          </View>
          <MoneyText
            amount={amount}
            currency={currency as CurrencyCode}
            locale={locale}
            mode="balance"
            direction={direction}
          />
        </View>
        <Button
          label={t.fx.addRateAction}
          size="sm"
          variant="secondary"
          accessibilityLabel={`${name}. ${t.fx.noRateYet}. ${t.fx.addRateAction}`}
          onPress={onAddRate}
        />
      </Row>
    </Tile>
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
  past = false,
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
  /** A recorded payment (history) reads in the past tense: "paid", not "pays". */
  past?: boolean;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const dateText = date
    ? dateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(
        new Date(date),
      )
    : null;
  const who = fill(past ? t.misc.settleHistoryPaid : t.simplifyPaysWhom, {
    from: fromName,
    to: toName,
  });
  const amountText = format(money(amount, currency as CurrencyCode), { locale });
  return (
    <Tile dense>
      <Row
        accessible
        accessibilityLabel={`${who}. ${amountText}${dateText ? `. ${dateText}` : ''}`}
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
          {dateText ? (
            <Text variant="micro" tone="muted">
              {dateText}
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
  caption,
}: {
  hero: SettleHero;
  currency: string;
  locale: string;
  /** "Includes ₫ bills at their recorded rates", when any bill was converted. */
  caption: string | null;
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
        minHeight: 72,
        overflow: 'hidden',
        justifyContent: 'center',
      }}
    >
      {/* Small and tucked in the corner: at 132x70 the wallet cost more height
          than the figures it sat beside. */}
      <Image
        source={WALLET_ART}
        style={{ position: 'absolute', end: 8, bottom: 4, width: 64, height: 40 }}
        resizeMode="contain"
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      {hero.tone === 'settled' ? (
        <Text variant="title" accessibilityRole="header">
          {t.allSettled}
        </Text>
      ) : (
        <View accessible accessibilityRole="header" style={{ paddingEnd: 72 }}>
          {/* Label and count share a line: "You owe · across 1 payment". */}
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {hero.tone === 'owe' ? t.youOwe : t.youAreOwed}
            {' · '}
            {plural(locale, hero.count, t.misc.settlePaymentsCount)}
          </Text>
          <MoneyText
            amount={hero.amount}
            currency={currency as CurrencyCode}
            locale={locale}
            variant="title"
            mode="balance"
            direction={hero.tone === 'owe' ? BalanceDirection.YouOwe : BalanceDirection.OwedToYou}
            style={{ fontSize: 28, lineHeight: 34 }}
          />
          {caption ? (
            <Text variant="micro" tone="muted" numberOfLines={2}>
              {caption}
            </Text>
          ) : null}
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
