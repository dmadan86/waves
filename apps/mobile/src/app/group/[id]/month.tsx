/**
 * One month of spending, day by day (the drill under the Spending chart).
 *
 * The insights screen answers "what did we spend, month by month". A column
 * there is a total with no way in — this is the way in: tap a month and land
 * on its days, tap an expense and land on the expense. Nothing new is summed
 * server-side; it reads the same local expenses the group page shows and slices
 * them to the month and currency the tapped column stood for.
 *
 * Built from the standard components (docs/design-standard.md): scenic header
 * with the Group / Just me pills, a stat card for the month, then one card per day.
 *
 * It starts in the scope the chart was in, and the pills switch it. In "group" scope a row is the whole
 * expense; in "mine" scope it is this person's share of it, and expenses they
 * had no share in are not shown — so the day subtotals and the screen total add
 * back up to the column that was tapped, and never to a different number.
 */

import { useMemo, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import { byNewest, format, formatParts, paidBy } from '@waves/core';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { EmptyState, Text, useTheme } from '@waves/ui';

import { CategoryBadge } from '@/components/Category';
import {
  ListRow,
  SCENIC_OVERLAP,
  ScenicHeader,
  SectionHeader,
  SegmentedPills,
  StandardCard,
  StatCard,
} from '@/components/standard';
import { memberLookup, useGroup } from '@/data/hooks';
import { expenseTitle } from '@/data/expenseTitle';
import { isViewer, type ExpenseRow } from '@/data/types';
import { fill, plural, useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { router } from '@/lib/navigation';

import { useBottomClearance } from '@/lib/clearance';
import { dateTimeFormat } from '@/lib/dateTimeFormat';
import { memberNameById } from '@/lib/memberName';

/** One day of the month: its date, its total and the expenses on it. */
interface DayItem {
  day: string;
  total: bigint;
  items: { expense: ExpenseRow; amount: bigint }[];
}

/** Sum of this member's shares in a version, in minor units. */
function myShare(shares: { member_id: string; amount: string }[], memberId: string | null): bigint {
  if (!memberId) return 0n;
  return shares
    .filter((share) => share.member_id === memberId)
    .reduce((sum, share) => sum + BigInt(share.amount), 0n);
}

export default function SpendingMonthScreen() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const params = useLocalSearchParams<{
    id: string;
    month: string;
    currency: string;
    scope: string;
  }>();
  const groupId = params.id ?? '';
  const month = (params.month ?? '').slice(0, 7); // 'YYYY-MM'
  const currency = params.currency ?? '';
  const [mine, setMine] = useState(params.scope === 'mine');

  // Identity for "which member am I", from the session rather than the profile:
  // the session is on the device at launch, the profile is a fetch that lands
  // later, and in the gap `profile?.id` is undefined — which `isViewer` refuses
  // to match, but only if it is given the right thing to compare. See
  // `lib/auth.useViewerId`.
  const viewerId = useViewerId();

  const { members, everyone, expenses } = useGroup(groupId);

  const myMemberId = useMemo(
    () => (members.data ?? []).find((member) => isViewer(member, viewerId))?.id ?? null,
    [members.data, viewerId],
  );

  const lookup = memberLookup(everyone.data);
  const nameOf = (memberId: string | null): string => {
    return memberNameById(lookup, memberId, {
      viewerId,
      someone: t.misc.someone,
      leftLabel: t.misc.memberLeft,
    });
  };

  // The expenses that make up the tapped column: live, in this currency, in this
  // month, and — in "mine" scope — ones this person actually had a share in.
  // Paired with the amount the row should show, so the day maths never re-reads
  // the scope.
  const rows = useMemo(() => {
    const out: { expense: ExpenseRow; amount: bigint; day: string }[] = [];
    for (const expense of expenses.rows) {
      if (expense.deleted_at) continue;
      const version = expense.currentVersion;
      if (!version || version.currency !== currency) continue;
      if (version.expense_date.slice(0, 7) !== month) continue;
      const amount = mine ? myShare(version.shares, myMemberId) : BigInt(version.amount);
      if (mine && amount === 0n) continue;
      out.push({ expense, amount, day: version.expense_date.slice(0, 10) });
    }
    return out;
  }, [expenses.rows, currency, month, mine, myMemberId]);

  // Newest day first, and newest expense first within a day — a ledger reads
  // most-recent-down, same as the group page.
  const days = useMemo(() => {
    const byDay = new Map<string, { total: bigint; items: typeof rows }>();
    for (const row of rows) {
      const bucket = byDay.get(row.day) ?? { total: 0n, items: [] };
      bucket.total += row.amount;
      bucket.items.push(row);
      byDay.set(row.day, bucket);
    }
    return [...byDay.entries()].sort(byNewest(([day]) => day));
  }, [rows]);

  const total = rows.reduce((sum, row) => sum + row.amount, 0n);

  const [year, monthNo] = month.split('-');
  const monthStart = new Date(Date.UTC(Number(year), Number(monthNo) - 1, 1));
  const monthTitle = Number.isNaN(monthStart.getTime())
    ? ''
    : dateTimeFormat(locale, {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(monthStart);

  // 'YYYY-MM-DD' read with the parts, in UTC, so a phone east of the line does
  // not label the 1st as the last of the month before.
  const dayLabel = (day: string): string => {
    const [y, m, d] = day.split('-');
    return dateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))));
  };

  // One recyclable item per day — a card of that day's rows under its heading.
  // Mounting only the visible days keeps a busy month on a trip cheap.
  const dayItems: DayItem[] = useMemo(
    () =>
      days.map(([day, bucket]) => ({
        day,
        total: bucket.total,
        items: bucket.items.map(({ expense, amount }) => ({ expense, amount })),
      })),
    [days],
  );

  const money = (minor: bigint) => format({ minor, currency }, { locale });
  const totalParts = formatParts({ minor: total, currency }, { locale });

  const renderDay = ({ item }: { item: DayItem }) => (
    <View style={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.md }}>
      <SectionHeader
        title={dayLabel(item.day)}
        trailing={
          <Text tone="muted" style={{ fontWeight: '600' }}>
            {money(item.total)}
          </Text>
        }
      />
      <StandardCard style={{ paddingVertical: theme.spacing.xs }}>
        {item.items.map(({ expense, amount }, index) => {
          const version = expense.currentVersion;
          // Who paid, by the same rule the group ledger uses (paidBy): one
          // person is named, several are counted. Naming payers[0] put a
          // shared bill entirely on whoever happened to sort first.
          const paid = paidBy(version?.payers ?? []);
          const title = expenseTitle(
            version?.description,
            version?.category,
            t,
            version?.category_meta,
          );
          return (
            <ListRow
              key={expense.id}
              leading={
                <CategoryBadge
                  category={version?.category}
                  meta={version?.category_meta}
                  description={version?.description}
                  size={28}
                />
              }
              title={title}
              subtitle={
                paid.kind === 'several'
                  ? plural(locale, paid.count, t.expense.paidByCount)
                  : fill(t.expense.paidByName, { name: nameOf(paid.memberId) })
              }
              amount={money(amount)}
              onPress={() => router.push(`/group/${groupId}/expense/${expense.id}`)}
              divider={index < item.items.length - 1}
            />
          );
        })}
      </StandardCard>
    </View>
  );

  const header = (
    <>
      <ScenicHeader title={monthTitle}>
        <SegmentedPills<'group' | 'mine'>
          value={mine ? 'mine' : 'group'}
          onChange={(value) => setMine(value === 'mine')}
          options={[
            { value: 'group', label: t.extras.theGroup },
            { value: 'mine', label: t.extras.justMe },
          ]}
        />
      </ScenicHeader>
      <View
        style={{
          marginTop: -SCENIC_OVERLAP,
          paddingHorizontal: theme.spacing.lg,
          marginBottom: theme.spacing.xl,
        }}
      >
        <StatCard
          label={t.spendTotal}
          lead={totalParts.lead}
          fraction={`${totalParts.fraction}${totalParts.trail}`}
          accessibilityLabel={`${t.spendTotal}: ${money(total)}`}
          caption={
            <Text variant="caption" tone="muted">
              {plural(locale, rows.length, t.importLedger.expenseCount)}
            </Text>
          }
        />
      </View>
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.bg }}>
      {expenses.isLoading ? (
        <>
          {header}
          <View style={{ padding: theme.spacing.xl }}>
            <ActivityIndicator color={theme.color.brand} />
          </View>
        </>
      ) : (
        <FlashList
          data={dayItems}
          extraData={`${locale}|${theme.scheme}|${mine}`}
          keyExtractor={(item) => item.day}
          renderItem={renderDay}
          ListHeaderComponent={header}
          ListEmptyComponent={<EmptyState title={t.nothingYet} body={t.nothingToChart} />}
          ItemSeparatorComponent={() => <View style={{ height: theme.spacing.xl }} />}
          // The group ledger's settings: render well beyond the viewport so a
          // hard fling down a busy month never outruns recycling and flashes
          // blank rows.
          drawDistance={1500}
          contentContainerStyle={{ paddingBottom: clearance }}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={
            mine ? (
              <Text
                variant="micro"
                tone="muted"
                align="center"
                style={{ marginTop: theme.spacing.md }}
              >
                {t.extras.yourShareNote}
              </Text>
            ) : null
          }
        />
      )}
    </View>
  );
}
