/**
 * The Vendors tab of an Event group (docs/event-organizer.md): who the
 * organiser has paid advances to, how much, what is still owed and when.
 * All the grouping/maths lives in `lib/eventVendors`; this only draws it.
 *
 * "Pay balance" opens the add-expense form prefilled (vendor, sub-event,
 * amount = balance) and carries `settlesExpenseId`; add-expense clears the
 * advance's balance once the payment is saved.
 */

import { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';

import { subEventsForTemplate } from '@waves/core';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ChipRow,
  EmptyState,
  iconSize,
  MoneyText,
  Row,
  Text,
  useScreenClearance,
  useTheme,
} from '@waves/ui';

import { useBlockedUsers } from '@/data/blocked';
import { memberLookup, useGroup } from '@/data/hooks';
import { displayName } from '@/data/types';
import { fill, plural, useStrings } from '@/i18n';
import { showDate } from '@/lib/expenseDay';
import {
  groupVendors,
  vendorSubEventIds,
  vendorSummary,
  VendorStatus,
  type VendorCandidate,
  type VendorEntry,
  type VendorFilter,
} from '@/lib/eventVendors';
import { router } from '@/lib/navigation';
import { useViewerId } from '@/lib/auth';

export function VendorsBody({ groupId, today }: { groupId: string; today: string }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const clearance = useScreenClearance();
  const viewerId = useViewerId();
  const { blockedIds } = useBlockedUsers();
  const { group, members, expenses } = useGroup(groupId);
  const [filter, setFilter] = useState<VendorFilter>('all');
  const [subEvent, setSubEvent] = useState<string | null>(null);

  const lookup = useMemo(() => memberLookup(members.data), [members.data]);
  const nameOf = (memberId: string | null): string => {
    const member = memberId ? lookup.get(memberId) : undefined;
    return member ? displayName(member, viewerId, blockedIds, t.misc.someone) : t.misc.someone;
  };

  const candidates: VendorCandidate[] = useMemo(
    () =>
      expenses.rows
        .filter((expense) => expense.currentVersion && !expense.deleted_at)
        .map((expense) => {
          const v = expense.currentVersion!;
          const lead = v.payers.reduce<{ id: string; amount: bigint } | null>((best, row) => {
            const amount = BigInt(row.amount);
            return best === null || amount > best.amount ? { id: row.member_id, amount } : best;
          }, null);
          return {
            expenseId: expense.id,
            description: v.description,
            currency: v.currency,
            amountMinor: BigInt(v.amount),
            isDeposit: v.is_deposit ?? false,
            balanceDueMinor: v.balance_due_minor == null ? null : BigInt(v.balance_due_minor),
            balanceDueDate: v.balance_due_date ?? null,
            subEventId: v.sub_event_id ?? null,
            payerMemberId: lead?.id ?? null,
            expenseDate: v.expense_date,
          };
        }),
    [expenses.rows],
  );

  const templateSubEvents = subEventsForTemplate(group.data?.event_template);
  const emojiOf = (id: string | null): string =>
    (id ? templateSubEvents.find((s) => s.id === id)?.emoji : undefined) ?? '';
  const subEventLabel = (id: string): string =>
    `${emojiOf(id)} ${t.eventSubEvents[id] ?? id}`.trim();

  const summary = useMemo(
    () => vendorSummary(candidates, today, subEvent),
    [candidates, today, subEvent],
  );
  const vendors = useMemo(
    () => groupVendors(candidates, today, filter, subEvent),
    [candidates, today, filter, subEvent],
  );
  const subEventIds = useMemo(() => vendorSubEventIds(candidates), [candidates]);
  const hasAny = candidates.some((c) => c.isDeposit);

  const o = t.eventOrganizer;

  const payBalance = (entry: VendorEntry, vendorName: string) => {
    router.push({
      pathname: `/group/${groupId}/add-expense`,
      params: {
        quick: '1',
        description: vendorName,
        amount: entry.balanceMinor.toString(),
        currency: entry.currency,
        subEventId: entry.subEventId ?? '',
        settlesExpenseId: entry.expenseId,
      },
    });
  };

  const statusTone = (status: VendorStatus) =>
    status === VendorStatus.Overdue
      ? 'negative'
      : status === VendorStatus.PaidOff
        ? 'positive'
        : 'neutral';
  const statusLabel = (status: VendorStatus) =>
    status === VendorStatus.Overdue
      ? o.statusOverdue
      : status === VendorStatus.PaidOff
        ? o.paidOff
        : o.statusDue;

  const money = (
    amount: bigint,
    currency: string,
    variant: 'caption' | 'body' | 'subheading' = 'caption',
  ) => (
    <MoneyText amount={amount} currency={currency} locale={locale} variant={variant} mode="plain" />
  );

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.lg,
          paddingBottom: clearance,
          gap: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        {!hasAny ? (
          <EmptyState
            title={o.vendorsEmptyTitle}
            body={o.vendorsEmptyBody}
            icon={
              <Ionicons
                name="storefront-outline"
                size={iconSize.xxl}
                color={theme.color.textMuted}
              />
            }
          />
        ) : (
          <>
            <Card style={{ gap: theme.spacing.sm }} accessible accessibilityRole="summary">
              <Row style={{ gap: theme.spacing.lg }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="micro" tone="muted">
                    {o.vendorsAdvancesPaid}
                  </Text>
                  {summary.totals.map((row) => (
                    <View key={row.currency}>
                      {money(row.advancesMinor, row.currency, 'subheading')}
                    </View>
                  ))}
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="micro" tone="muted">
                    {o.vendorsBalanceDue}
                  </Text>
                  {summary.totals.map((row) => (
                    <View key={row.currency}>
                      {money(row.balanceMinor, row.currency, 'subheading')}
                    </View>
                  ))}
                </View>
              </Row>
              <Row style={{ gap: theme.spacing.sm, flexWrap: 'wrap' }}>
                <Badge
                  label={plural(locale, summary.overdueCount, o.overdueCount)}
                  tone={summary.overdueCount > 0 ? 'negative' : 'neutral'}
                />
                <Badge label={fill(o.paidOffCount, { n: summary.paidOffCount })} tone="positive" />
              </Row>
            </Card>

            <ChipRow<VendorFilter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: o.filterAll },
                { value: 'due', label: o.filterDue },
                { value: 'overdue', label: o.filterOverdue },
                { value: 'paidOff', label: o.paidOff },
              ]}
            />
            {subEventIds.length > 1 ? (
              <ChipRow<string>
                value={subEvent ?? 'all'}
                onChange={(next) => setSubEvent(next === 'all' ? null : next)}
                options={[
                  { value: 'all', label: o.allSubEvents },
                  ...subEventIds.map((id) => ({ value: id, label: subEventLabel(id) })),
                ]}
              />
            ) : null}

            {vendors.length === 0 ? (
              <Text
                variant="caption"
                tone="muted"
                style={{ textAlign: 'center', paddingVertical: theme.spacing.xl }}
              >
                {o.vendorsFilteredEmpty}
              </Text>
            ) : null}

            {vendors.map((vendor) => (
              <Card key={vendor.key} style={{ gap: theme.spacing.sm }}>
                <Row
                  style={{
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                  }}
                >
                  <Text
                    variant="subheading"
                    numberOfLines={1}
                    style={{ flex: 1 }}
                    accessibilityRole="header"
                  >
                    {vendor.name}
                  </Text>
                  <Badge label={statusLabel(vendor.status)} tone={statusTone(vendor.status)} />
                </Row>
                {vendor.entries.map((entry) => {
                  const overdue = entry.status === VendorStatus.Overdue;
                  const dueText = entry.balanceDueDate
                    ? fill(overdue ? o.overdueSince : entry.dueSoon ? o.dueSoonOn : o.dueOn, {
                        date: showDate(entry.balanceDueDate, locale),
                      })
                    : entry.status === VendorStatus.PaidOff
                      ? o.paidOff
                      : o.dueWhenever;
                  const payer = nameOf(entry.payerMemberId);
                  const label = [
                    vendor.name,
                    `${o.advancePaid} ${entry.advanceMinor.toString()} ${entry.currency}`,
                    entry.balanceMinor > 0n
                      ? `${o.balanceDueLabel} ${entry.balanceMinor.toString()} ${entry.currency}`
                      : o.paidOff,
                    dueText,
                    fill(o.paidBy, { name: payer }),
                  ].join(', ');
                  return (
                    <View key={entry.expenseId} style={{ gap: theme.spacing.xs }}>
                      <Pressable
                        onPress={() => router.push(`/group/${groupId}/expense/${entry.expenseId}`)}
                        accessibilityRole="button"
                        accessibilityLabel={label}
                        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, gap: 2 })}
                      >
                        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                          <Row style={{ gap: theme.spacing.xs, alignItems: 'center', flex: 1 }}>
                            {entry.subEventId ? (
                              <Text variant="caption" numberOfLines={1}>
                                {subEventLabel(entry.subEventId)}
                              </Text>
                            ) : null}
                          </Row>
                          <Row style={{ gap: theme.spacing.xs, alignItems: 'center' }}>
                            <Avatar name={payer} size={18} />
                            <Text variant="micro" tone="muted" numberOfLines={1}>
                              {fill(o.paidBy, { name: payer })}
                            </Text>
                          </Row>
                        </Row>
                        <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                          <Text variant="caption" tone="muted">
                            {o.advancePaid}
                          </Text>
                          {money(entry.advanceMinor, entry.currency)}
                        </Row>
                        {entry.balanceMinor > 0n ? (
                          <>
                            <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                              <Text variant="caption" tone="muted">
                                {o.balanceDueLabel}
                              </Text>
                              {money(entry.balanceMinor, entry.currency)}
                            </Row>
                            <Text
                              variant="micro"
                              tone={overdue ? 'negative' : 'muted'}
                              style={
                                entry.dueSoon
                                  ? { color: theme.color.warning, fontWeight: '600' }
                                  : undefined
                              }
                            >
                              {dueText}
                            </Text>
                          </>
                        ) : null}
                      </Pressable>
                      {entry.balanceMinor > 0n ? (
                        <Button
                          label={o.payBalance}
                          size="sm"
                          variant="secondary"
                          accessibilityLabel={fill(o.payBalanceFor, { vendor: vendor.name })}
                          onPress={() => payBalance(entry, vendor.name)}
                        />
                      ) : null}
                    </View>
                  );
                })}
              </Card>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}
