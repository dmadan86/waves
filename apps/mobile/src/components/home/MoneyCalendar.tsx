/** The money calendar: a month grid with coloured dots, filter chips and the month's items with a quick action. */

import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Row, Screen, Text, useTheme } from '@waves/ui';

import { addBillRoute, DueRow, useDueMoney } from '@/components/home/ComingUpHome';
import {
  MonthSwitcher,
  EmptyCard,
  PlainHeader,
  SegmentedPills,
  StandardCard,
} from '@/components/standard';
import { TabIconButton } from '@/components/home/TabHeader';
import { useComingUp } from '@/data/useComingUp';
import { useMarkBillPaid } from '@/data/groupRecurring';
import { usePostRecurring } from '@/data/postRecurring';
import { useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';
import { shiftMonth } from '@/lib/monthNav';
import {
  expandDue,
  filterItems,
  gridRows,
  monthGrid,
  type DueFilter,
  type DueItem,
  type DueKind,
} from '@/lib/moneyCalendar';

type Action = 'pay' | 'markPaid' | 'renew' | 'remind';

/** Which quick action a row offers: record what is paid on its own, open the rest. */
export function actionFor(item: DueItem): Action {
  if (item.income) return 'remind';
  if (item.kind === 'renewal') return 'renew';
  if (item.autoPay || item.kind === 'loan') return 'markPaid';
  return 'pay';
}

export function dotColor(theme: ReturnType<typeof useTheme>, kind: DueKind): string {
  switch (kind) {
    case 'loan':
      return theme.color.warning;
    case 'renewal':
      return theme.color.brand;
    case 'income':
    case 'rent':
      return theme.color.positive;
    default:
      return theme.color.negative;
  }
}

export function MoneyCalendar({
  groupId,
  ledgerGroupId,
  currency,
}: {
  groupId?: string;
  ledgerGroupId?: string;
  currency?: string;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const c = t.comingUp;
  const clearance = useBottomClearance();
  const { sources, dc, today, ledgerRules, groupRules } = useComingUp({
    groupId,
    ledgerGroupId,
    currency,
  });
  const fmt = useDueMoney(dc);
  const { post } = usePostRecurring();
  const markGroupPaid = useMarkBillPaid(groupId ?? '');
  const current = today.slice(0, 7);
  const [month, setMonth] = useState(current);
  const [filter, setFilter] = useState<DueFilter>('all');
  const [picked, setPicked] = useState<string | null>(null);

  const monthItems = useMemo(
    () =>
      expandDue(sources, today, `${month}-31`).filter(
        (i) => i.date.slice(0, 7) === month || (month === current && i.date < today),
      ),
    [sources, today, month, current],
  );
  const grid = useMemo(() => monthGrid(month, monthItems), [month, monthItems]);
  const shown = filterItems(monthItems, filter).filter((i) => (picked ? i.date === picked : true));
  const weekdays = useMemo(() => {
    const fmtDay = new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' });
    return Array.from({ length: 7 }, (_, i) => fmtDay.format(new Date(Date.UTC(2024, 0, 1 + i))));
  }, [locale]);
  const label = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
    new Date(`${month}-01T00:00:00`),
  );

  const run = (item: DueItem): void => {
    const action = actionFor(item);
    if (action === 'markPaid') {
      const rule = ledgerRules.find((r) => r.id === item.sourceId);
      const groupRule = groupRules.find((r) => r.id === item.sourceId);
      if (rule && !groupId) void post(rule, item.date);
      else if (groupRule) void markGroupPaid(groupRule, item.date);
      else router.push(item.href as never);
      return;
    }
    router.push(item.href as never);
  };
  const actionLabel: Record<Action, string> = {
    pay: c.actPay,
    markPaid: c.actMarkPaid,
    renew: c.actRenew,
    remind: c.actRemind,
  };
  const chip = (f: DueFilter, text: string): { value: DueFilter; label: string } => ({
    value: f,
    label: f === 'all' ? `${text} · ${monthItems.length}` : text,
  });

  return (
    <Screen edges={[]}>
      <PlainHeader
        title={c.calendarTitle}
        trailing={
          <TabIconButton
            icon="add"
            label={c.addDueDate}
            onPress={() => router.push(addBillRoute(groupId))}
          />
        }
      />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance + theme.spacing.xl,
          gap: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        <StandardCard style={{ gap: theme.spacing.sm }}>
          <MonthSwitcher
            label={label}
            prevLabel={t.personal.prevMonth}
            nextLabel={t.personal.nextMonth}
            prevDisabled={month <= current}
            nextDisabled={month >= shiftMonth(current, 11)}
            onPrev={() => {
              setPicked(null);
              setMonth(shiftMonth(month, -1));
            }}
            onNext={() => {
              setPicked(null);
              setMonth(shiftMonth(month, 1));
            }}
          />
          <Row>
            {weekdays.map((w, i) => (
              <Text
                key={i}
                variant="micro"
                tone="muted"
                style={{ flex: 1, textAlign: 'center', fontWeight: '600' }}
              >
                {w}
              </Text>
            ))}
          </Row>
          <View>
            {gridRows(grid).map((week, w) => (
              <Row key={w}>
                {week.map((cell, i) => (
                  <View key={i} style={{ flex: 1, padding: 2 }}>
                    {cell ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected: picked === cell.date }}
                        accessibilityLabel={`${cell.day}, ${cell.kinds.length} ${c.calendarTitle}`}
                        onPress={() => setPicked(picked === cell.date ? null : cell.date)}
                        style={{
                          height: 40,
                          borderRadius: 10,
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 3,
                          backgroundColor:
                            picked === cell.date || cell.date === today
                              ? theme.color.brandSoft
                              : 'transparent',
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 13,
                            fontWeight: cell.kinds.length > 0 ? '700' : '500',
                          }}
                        >
                          {cell.day}
                        </Text>
                        <Row style={{ gap: 2, height: 6 }}>
                          {cell.kinds.slice(0, 3).map((k) => (
                            <View
                              key={k}
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: 3,
                                backgroundColor: dotColor(theme, k),
                              }}
                            />
                          ))}
                        </Row>
                      </Pressable>
                    ) : null}
                  </View>
                ))}
              </Row>
            ))}
          </View>
        </StandardCard>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <SegmentedPills<DueFilter>
            options={[
              chip('all', c.filterAll),
              chip('bills', c.filterBills),
              chip('loans', c.filterLoans),
              chip('renewals', c.filterRenewals),
              chip('income', c.filterIncome),
            ]}
            value={filter}
            onChange={setFilter}
          />
        </ScrollView>

        {shown.length === 0 ? (
          <EmptyCard
            icon="calendar-outline"
            title={c.nothingThisMonth}
            helper={c.nothingThisMonthHelp}
            action={{ label: c.addDueDate, onPress: () => router.push(addBillRoute(groupId)) }}
          />
        ) : (
          <StandardCard style={{ paddingVertical: theme.spacing.xs }}>
            {shown.map((item, i) => (
              <View key={item.key}>
                <DueRow
                  item={item}
                  fmt={fmt}
                  last={i === shown.length - 1}
                  onPress={() => run(item)}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${actionLabel[actionFor(item)]}, ${item.title}`}
                  onPress={() => run(item)}
                  hitSlop={6}
                  style={{
                    alignSelf: 'flex-end',
                    marginBottom: theme.spacing.sm,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 10,
                    backgroundColor: theme.color.brandSoft,
                  }}
                >
                  <Text variant="caption" tone="brand" style={{ fontWeight: '700' }}>
                    {actionLabel[actionFor(item)]}
                  </Text>
                </Pressable>
              </View>
            ))}
          </StandardCard>
        )}
      </ScrollView>
    </Screen>
  );
}
