/**
 * Personal "Today": the calm home. A week strip, one line of summary, what is
 * done, ONE "Needs you" card, one quiet nudge and what comes later this week.
 * Everything is computed on the device from the mirror.
 */

import { useState } from 'react';
import { View } from 'react-native';

import { Sheet, Text, useTheme } from '@waves/ui';
import type { PersonalTxn } from '@waves/core';

import { CategoryPicker } from '@/components/Category';
import { DoneLine } from '@/components/calm/DoneLine';
import { NeedRow, NeedsYouCard } from '@/components/calm/NeedsYouCard';
import { NudgeRow } from '@/components/calm/NudgeRow';
import { SummaryLine } from '@/components/calm/SummaryLine';
import { useRentActions } from '@/components/calm/useRentActions';
import { WeekStrip } from '@/components/calm/WeekStrip';
import { useWealthMoney } from '@/components/wealth/parts';
import { usePersonalWealth } from '@/data/personalWealth';
import { usePersonalLedger, useUpsertPersonalRecord } from '@/data/personal';
import { usePostRecurring } from '@/data/postRecurring';
import { fill, plural, useStrings } from '@/i18n';
import { budgetNudge } from '@/lib/calm/budgetNudge';
import { recentlyPaid } from '@/lib/calm/doneLine';
import { needsYou, uncategorizedTxns, visibleNeeds } from '@/lib/calm/needsYou';
import { rentItems } from '@/lib/calm/rentDue';
import { dailyPace, spendByDate, weekDays, weekSummary, weekStartDate } from '@/lib/calm/weekPace';
import { firstWeekday } from '@/lib/calendarGrid';
import { dateTimeFormat } from '@/lib/dateTimeFormat';
import { router } from '@/lib/navigation';
import { budgetsOverview } from '@/lib/budgetsOverview';
import { entryRecord } from '@/lib/personalEntry';
import { billRows } from '@/lib/personalUpcoming';
import { usePersonalUpcoming } from '@/components/personal/PersonalHomeParts';
import { titleOf } from '@/lib/dateReminders/text';
import { useSourceLabel } from '@/components/IncomeSource';

const HORIZON = 7;

export function PersonalToday({ today, currency }: { today: string; currency: string }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const c = t.calm;
  const fmt = useWealthMoney();
  const ledger = usePersonalLedger();
  const wealth = usePersonalWealth();
  const upsert = useUpsertPersonalRecord();
  const { post } = usePostRecurring();
  const rentActions = useRentActions(undefined, today);
  const sourceLabel = useSourceLabel();
  const [expanded, setExpanded] = useState(false);
  const [categorizing, setCategorizing] = useState<PersonalTxn | null>(null);
  const month = today.slice(0, 7);

  // The week strip.
  const overview = budgetsOverview(ledger.budgets, ledger.txns, month, currency);
  const pace = dailyPace(overview?.limit ?? null, month);
  const start = weekStartDate(today, firstWeekday(locale));
  const end = new Date(Date.parse(`${start}T00:00:00Z`) + 6 * 864e5).toISOString().slice(0, 10);
  const upcoming = usePersonalUpcoming(
    { txns: ledger.txns, recurrings: ledger.recurrings, currency, today },
    0,
  );
  const dueDates = new Set(
    upcoming.filter((r) => r.kind === 'bill' && !r.income && r.date).map((r) => r.date!),
  );
  const days = weekDays({
    today,
    weekStart: firstWeekday(locale),
    spent: spendByDate(ledger.txns, currency, start, end),
    pace,
    dueDates,
  });
  const week = weekSummary(days, pace);
  const letter = (weekday: number): string =>
    dateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2026, 10, 22 + weekday)),
    );
  const longDay = (iso: string): string =>
    dateTimeFormat(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(new Date(`${iso}T00:00:00Z`));

  // What needs the person.
  const rent = rentItems({
    properties: wealth.properties,
    tenancies: wealth.tenancies,
    recurrings: ledger.recurrings,
    txns: ledger.txns,
    today,
    horizonDays: 0,
    fallbackCurrency: currency,
  }).filter((r) => r.currency === currency);
  const items = needsYou({
    bills: billRows(ledger.txns, ledger.recurrings, currency, today, 0),
    recurrings: ledger.recurrings,
    rent,
    uncategorized: uncategorizedTxns(ledger.txns, month, currency),
  });
  const shown = visibleNeeds(items, expanded);
  const hidden = items.length - shown.length;

  const done = recentlyPaid(ledger.txns, today);
  const nudge = budgetNudge(ledger.budgets, ledger.txns, currency, today);
  const later = upcoming.filter((r) => r.inDays > 0 && r.inDays <= HORIZON && !r.raise).slice(0, 3);

  const rowDate = (iso: string): string =>
    dateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(new Date(`${iso}T00:00:00Z`));
  const noteOf = (txn: PersonalTxn): string => txn.note?.trim() || '—';

  return (
    <View style={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.md }}>
      <WeekStrip
        days={days}
        weekdayLetter={letter}
        dayLabel={(d) => `${longDay(d.date)}, ${fmt(d.spent, currency)}`}
      />
      <SummaryLine
        text={fill(c.weekSpent, { amount: fmt(week.spent, currency) })}
        verdict={week.verdict === null ? null : week.verdict === 'onTrack' ? c.onTrack : c.overPace}
        warn={week.verdict === 'overPace'}
      />
      {done ? (
        <DoneLine
          text={
            done.count === 1
              ? fill(c.paidOne, {
                  title:
                    done.latest.note?.trim() ||
                    sourceLabel(done.latest.category) ||
                    t.personal.expense,
                  amount: fmt(done.latest.amount, done.latest.currency),
                  when: done.when === 'today' ? c.whenToday : c.whenYesterday,
                })
              : plural(locale, done.count, c.paidMany)
          }
        />
      ) : null}

      {items.length > 0 ? (
        <NeedsYouCard
          title={plural(locale, items.length, c.needsTitle)}
          more={
            hidden > 0
              ? { label: fill(c.showMore, { n: String(hidden) }), onPress: () => setExpanded(true) }
              : expanded && items.length > 3
                ? { label: c.showLess, onPress: () => setExpanded(false) }
                : undefined
          }
        >
          {shown.map((item) => {
            if (item.kind === 'rent') {
              const r = rent.find((x) => x.key === item.key)!;
              const amount = fmt(r.amount, r.currency);
              return (
                <NeedRow
                  key={item.key}
                  icon="home-outline"
                  title={fill(c.rentTitle, { unit: r.unit, amount })}
                  subtitle={
                    r.inDays < 0
                      ? plural(locale, -r.inDays, c.rentOverdue).replaceAll('{tenant}', r.tenant)
                      : fill(c.rentDueToday, { tenant: r.tenant })
                  }
                  subtitleTone={r.inDays < 0 ? 'negative' : 'muted'}
                  actions={[
                    { label: c.remind, onPress: () => rentActions.remind(r, amount) },
                    {
                      label: c.markReceived,
                      primary: true,
                      onPress: () => rentActions.markReceived(r),
                    },
                  ]}
                />
              );
            }
            if (item.kind === 'bill') {
              const title =
                item.rule.note?.trim() || sourceLabel(item.rule.category) || t.personal.expense;
              const amount = fmt(item.rule.amount, item.rule.currency);
              return (
                <NeedRow
                  key={item.key}
                  icon="receipt-outline"
                  title={title}
                  subtitle={
                    item.inDays < 0
                      ? plural(locale, -item.inDays, c.billOverdue).replaceAll('{amount}', amount)
                      : fill(c.billDueToday, { amount })
                  }
                  subtitleTone={item.inDays < 0 ? 'negative' : 'muted'}
                  actions={[
                    {
                      label: c.markPaid,
                      accessibilityLabel: `${c.markPaid}, ${title}`,
                      onPress: () => void post(item.rule, item.date),
                    },
                  ]}
                />
              );
            }
            const first = item.txns[0]!;
            return (
              <NeedRow
                key={item.key}
                icon="pricetag-outline"
                title={plural(locale, item.txns.length, c.uncatTitle)}
                subtitle={item.txns
                  .slice(0, 2)
                  .map((x) => `${noteOf(x)} ${fmt(x.amount, x.currency)}`)
                  .join(' · ')}
                actions={[{ label: c.pickCategory, onPress: () => setCategorizing(first) }]}
              />
            );
          })}
        </NeedsYouCard>
      ) : (
        <View style={{ gap: 2, paddingVertical: theme.spacing.sm }}>
          <Text variant="subheading">{c.allSet}</Text>
          <Text variant="caption" tone="muted">
            {c.allSetHelp}
          </Text>
        </View>
      )}

      {nudge ? (
        <NudgeRow
          title={fill(c.budgetUsed, {
            name: nudge.category
              ? (t.categories[nudge.category as keyof typeof t.categories] ?? nudge.category)
              : t.personal.overall,
            pct: String(nudge.percent),
          })}
          body={
            nudge.remaining < 0n
              ? fill(c.budgetOver, { amount: fmt(-nudge.remaining, currency) })
              : nudge.daysLeft > 0
                ? plural(locale, nudge.daysLeft, c.budgetLeftDays).replaceAll(
                    '{amount}',
                    fmt(nudge.remaining, currency),
                  )
                : fill(c.budgetLeft, { amount: fmt(nudge.remaining, currency) })
          }
          action={c.review}
          onAction={() => router.push('/personal/budgets')}
        />
      ) : null}

      {later.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text accessibilityRole="header" variant="subheading">
            {c.later}
          </Text>
          <View
            style={{
              backgroundColor: theme.color.surface,
              borderRadius: 12,
              paddingHorizontal: theme.spacing.lg,
            }}
          >
            {later.map((row, i) => (
              <View
                key={row.key}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.md,
                  paddingVertical: theme.spacing.sm,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: theme.color.border,
                }}
              >
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text variant="body" style={{ fontWeight: '600' }}>
                    {row.item
                      ? titleOf(row.item, t.dates)
                      : row.title || sourceLabel(row.category ?? null) || t.personal.expense}
                  </Text>
                  {row.amount !== undefined && row.currency ? (
                    <Text variant="caption" tone="muted">
                      {fmt(row.amount, row.currency)}
                    </Text>
                  ) : null}
                </View>
                <Text variant="caption" tone="muted">
                  {rowDate(row.date ?? today)}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <Sheet
        visible={categorizing !== null}
        onClose={() => setCategorizing(null)}
        padded={false}
        closeLabel={t.common.close}
        style={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.lg, gap: 14 }}
      >
        <Text style={{ fontSize: 20, fontWeight: '800' }}>{t.personalHome.categorize}</Text>
        <CategoryPicker
          wrap
          value={null}
          onChange={(key) => {
            const txn = categorizing;
            setCategorizing(null);
            if (!txn) return;
            // The same record the entry form writes, only the category changed.
            upsert.mutate(
              entryRecord({ ...txn, category: key, note: txn.note ?? null }, null, { txn }),
            );
          }}
        />
      </Sheet>
    </View>
  );
}
