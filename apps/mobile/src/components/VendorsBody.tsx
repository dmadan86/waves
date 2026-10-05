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
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { subEventsForTemplate } from '@waves/core';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ChipRow,
  IconButton,
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
import { vendorCandidates } from '@/lib/vendorCandidates';
import { useViewerId } from '@/lib/auth';

export function VendorsBody({
  groupId,
  today,
  initialFilter = 'all',
}: {
  groupId: string;
  today: string;
  initialFilter?: VendorFilter;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const clearance = useScreenClearance();
  const viewerId = useViewerId();
  const { blockedIds } = useBlockedUsers();
  const { group, members, expenses } = useGroup(groupId);
  const [filter, setFilter] = useState<VendorFilter>(initialFilter);
  const [subEvent, setSubEvent] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [showSubFilter, setShowSubFilter] = useState(false);

  const lookup = useMemo(() => memberLookup(members.data), [members.data]);
  const nameOf = (memberId: string | null): string => {
    const member = memberId ? lookup.get(memberId) : undefined;
    return member ? displayName(member, viewerId, blockedIds, t.misc.someone) : t.misc.someone;
  };

  const templateSubEvents = subEventsForTemplate(group.data?.event_template);
  const emojiOf = (id: string | null): string =>
    (id ? templateSubEvents.find((s) => s.id === id)?.emoji : undefined) ?? '';
  const subEventLabel = (id: string): string =>
    `${emojiOf(id)} ${t.eventSubEvents[id] ?? id}`.trim();

  const candidates: VendorCandidate[] = useMemo(
    () =>
      vendorCandidates(expenses.rows, {
        subEvent: subEventLabel,
        category: (id) => (t.categories as Record<string, string | undefined>)[id] ?? null,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expenses.rows, group.data?.event_template, t],
  );

  const summary = useMemo(
    () => vendorSummary(candidates, today, subEvent),
    [candidates, today, subEvent],
  );
  const vendors = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return groupVendors(candidates, today, filter, subEvent).filter(
      (vendor) => needle === '' || vendor.key.includes(needle),
    );
  }, [candidates, today, filter, subEvent, query]);
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
          <View
            style={{ alignItems: 'center', gap: theme.spacing.sm, paddingTop: theme.spacing.xl }}
          >
            <View
              accessible={false}
              importantForAccessibility="no-hide-descendants"
              style={{
                width: 96,
                height: 96,
                borderRadius: 48,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.color.brandSoft,
              }}
            >
              <Text style={{ fontSize: 44 }}>🏪</Text>
              <Text style={{ position: 'absolute', top: 6, right: 8, fontSize: 18 }}>✨</Text>
              <Text style={{ position: 'absolute', bottom: 8, left: 6, fontSize: 18 }}>🛍️</Text>
            </View>
            <Text variant="subheading" accessibilityRole="header">
              {o.vendorsEmptyTitle}
            </Text>
            <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
              {o.vendorsEmptyBody}
            </Text>
            <Button
              label={o.addVendor}
              size="md"
              icon={<Ionicons name="add" size={iconSize.md} color={theme.color.onButtonPrimary} />}
              onPress={() =>
                router.push({
                  pathname: `/group/${groupId}/add-expense`,
                  params: { deposit: '1', focus: 'description' },
                })
              }
            />
          </View>
        ) : (
          <>
            <Card
              style={{ paddingVertical: theme.spacing.md }}
              accessible
              accessibilityRole="summary"
            >
              <Row style={{ gap: theme.spacing.md }}>
                <Row style={{ flex: 1, gap: theme.spacing.sm, alignItems: 'flex-start' }}>
                  <SummaryIcon name="card-outline" />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="micro" tone="muted">
                      {o.vendorsAdvancesPaid}
                    </Text>
                    {summary.totals.map((row) => (
                      <View key={row.currency}>
                        {money(row.advancesMinor, row.currency, 'subheading')}
                      </View>
                    ))}
                    <Row style={{ gap: theme.spacing.xs, flexWrap: 'wrap' }}>
                      <Badge
                        label={plural(locale, summary.overdueCount, o.overdueCount)}
                        tone={summary.overdueCount > 0 ? 'negative' : 'neutral'}
                      />
                      <Badge
                        label={fill(o.paidOffCount, { n: summary.paidOffCount })}
                        tone="brand"
                      />
                    </Row>
                  </View>
                </Row>
                <View style={{ width: 1, backgroundColor: theme.color.border }} />
                <Row style={{ flex: 1, gap: theme.spacing.sm, alignItems: 'flex-start' }}>
                  <SummaryIcon name="time-outline" />
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
              </Row>
            </Card>

            <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
              <View style={{ flex: 1 }}>
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
              </View>
              <IconButton
                label={o.searchVendors}
                onPress={() => {
                  setSearching((on) => !on);
                  setQuery('');
                }}
              >
                <Ionicons name="search-outline" size={iconSize.md} color={theme.color.text} />
              </IconButton>
              {subEventIds.length > 0 ? (
                <IconButton
                  label={o.filterBySubEvent}
                  onPress={() => setShowSubFilter((on) => !on)}
                >
                  <Ionicons
                    name="options-outline"
                    size={iconSize.md}
                    color={subEvent ? theme.color.brand : theme.color.text}
                  />
                </IconButton>
              ) : null}
            </Row>
            {searching ? (
              <TextInput
                value={query}
                onChangeText={setQuery}
                autoFocus
                placeholder={o.searchVendors}
                placeholderTextColor={theme.color.textFaint}
                accessibilityLabel={o.searchVendors}
                style={{
                  height: 40,
                  paddingHorizontal: theme.spacing.md,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.color.surface,
                  color: theme.color.text,
                }}
              />
            ) : null}
            {showSubFilter && subEventIds.length > 0 ? (
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
                    {vendor.name || o.unnamedVendor}
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
                    vendor.name || o.unnamedVendor,
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
                          accessibilityLabel={fill(o.payBalanceFor, {
                            vendor: vendor.name || o.unnamedVendor,
                          })}
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

/** The small tinted disc a summary half leads with. */
function SummaryIcon({ name }: { name: 'card-outline' | 'time-outline' }) {
  const theme = useTheme();
  return (
    <View
      accessible={false}
      style={{
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.color.brandSoft,
      }}
    >
      <Ionicons name={name} size={iconSize.sm} color={theme.color.brand} />
    </View>
  );
}
