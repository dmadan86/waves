import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';

import { format, money, pickUpcoming } from '@waves/core';
import { Badge, Button, iconSize, Row, Sheet, Text, useTabBarClearance, useTheme } from '@waves/ui';

import { BALANCE_MASK } from '@/components/home/HomeBalanceCard';
import { GroupRow } from '@/components/home/GroupRow';
import { AddReminderSheet } from '@/components/personal/AddReminderSheet';
import { ICON_FOR, useWealthRows } from '@/components/personal/PersonalHomeParts';
import { PlainHeader } from '@/components/standard';
import { RaiseCard } from '@/components/wealth/RaiseCard';
import { todayIso, usePersonalLedger } from '@/data/personal';
import { useDateOccurrences } from '@/data/personalDates';
import { usePostRecurring } from '@/data/postRecurring';
import { plural, useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { usePersonalAmountsHidden } from '@/lib/amountsHidden';
import { useDefaultCurrency } from '@/lib/currency';
import { actionFor } from '@/lib/dateReminders/actions';
import { subtitleOf, titleOf } from '@/lib/dateReminders/text';
import { useRunDateAction } from '@/lib/dateReminders/useRunDateAction';
import { router } from '@/lib/navigation';
import {
  dateRows,
  filterUpcoming,
  groupUpcoming,
  upcomingView,
  type UpcomingTab,
  type UpcomingRow,
} from '@/lib/personalUpcoming';
import { nextDateLabel } from '@/lib/recurringList';

const TABS: { value: UpcomingTab; label: 'filterAll' | 'filterBills' | 'filterReminders' }[] = [
  { value: 'all', label: 'filterAll' },
  { value: 'bills', label: 'filterBills' },
  { value: 'reminders', label: 'filterReminders' },
];

export default function PersonalUpcomingScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const { t, locale } = useStrings();
  const h = t.personalHome;
  const currency = useDefaultCurrency();
  const ledger = usePersonalLedger();
  const { hidden } = usePersonalAmountsHidden();
  const { session, isGuest } = useAuth();
  const occurrences = useDateOccurrences();
  const runDateAction = useRunDateAction();
  const { post, isPending: posting } = usePostRecurring();
  const [today] = useState(() => todayIso());
  const [tab, setTab] = useState<UpcomingTab>('all');
  const [adding, setAdding] = useState(false);
  const [acting, setActing] = useState<{
    rule: (typeof ledger.recurrings)[number];
    date: string;
    title: string;
    subtitle: string;
    icon: keyof typeof Ionicons.glyphMap;
    status: string;
    overdue: boolean;
  } | null>(null);
  const wealth = useWealthRows({ ...ledger, today }, 90);
  const view = upcomingView({
    txns: ledger.txns,
    recurrings: ledger.recurrings,
    currency,
    today,
    dates: [...dateRows(session && !isGuest ? pickUpcoming(occurrences, 50) : []), ...wealth],
  });
  const rows = filterUpcoming(view, tab);
  const fmt = (amount: bigint, cur: string): string =>
    hidden ? BALANCE_MASK : format(money(amount, cur), { locale, trimZeros: true });
  const grouped = groupUpcoming(rows, today);
  const groups = [
    { label: h.overdue, items: grouped.overdue },
    { label: h.thisWeek, items: grouped.thisWeek },
    { label: h.laterThisMonth, items: grouped.laterThisMonth },
    { label: h.nextMonth, items: grouped.nextMonth },
  ];
  const titleOfRow = (row: UpcomingRow): string =>
    row.item ? titleOf(row.item, t.dates) : row.title || t.personal.expense;
  const subOfRow = (row: UpcomingRow): string =>
    row.item ? subtitleOf(row.item, t.dates, locale) : '';
  const status = (row: UpcomingRow): string =>
    row.inDays < 0 ? h.overdue : row.inDays === 0 ? h.today : plural(locale, row.inDays, h.inDays);
  const render = (row: UpcomingRow, index: number, list: readonly UpcomingRow[]) => {
    if (row.raise) return <RaiseCard key={row.key} prompt={row.raise} />;
    const item = row.item;
    const rule = row.ruleId ? ledger.recurrings.find((r) => r.id === row.ruleId) : undefined;
    const title = titleOfRow(row);
    const subtitle =
      row.kind === 'bill'
        ? `${row.income ? h.expected : h.due} ${nextDateLabel(row.date ?? '', locale, today)}`
        : subOfRow(row);
    const icon =
      row.kind === 'bill'
        ? row.income
          ? 'arrow-down-outline'
          : 'receipt-outline'
        : (ICON_FOR[item?.kind ?? ''] ?? 'calendar-outline');
    const dateLabel = status(row);
    const amountText =
      row.amount !== undefined && row.currency ? fmt(row.amount, row.currency) : '';
    return (
      <GroupRow
        key={row.key}
        title={title}
        memberLabel={subtitle}
        amountText={amountText}
        directionLabel={dateLabel}
        directionTone={row.inDays < 0 ? 'negative' : 'muted'}
        chevron
        tone={row.inDays < 0 ? 'negative' : undefined}
        icon={icon}
        iconColor={row.inDays < 0 ? theme.color.negative : undefined}
        locale={locale}
        divider={index > 0}
        onPress={() => {
          if (item) {
            if (actionFor(item)) runDateAction(item);
            else if (item.source === 'date')
              router.push({ pathname: '/dates/edit', params: { id: item.id } });
            else router.push('/dates');
          } else if (row.href) router.push(row.href as never);
          else if (rule)
            setActing({
              rule,
              date: row.date ?? rule.nextDate,
              title,
              subtitle,
              icon,
              status: dateLabel,
              overdue: row.inDays < 0,
            });
        }}
      />
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <PlainHeader
        title={h.upcomingTitle}
        trailing={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={h.addReminder}
            onPress={() => setAdding(true)}
            hitSlop={10}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.color.brandSoft,
            }}
          >
            <Ionicons name="add" size={iconSize.lg} color={theme.color.brand} />
          </Pressable>
        }
      />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance + theme.spacing.lg,
          gap: theme.spacing.md,
        }}
      >
        <Row
          style={{
            backgroundColor: theme.color.surface,
            borderRadius: theme.radius.pill,
            padding: 4,
            gap: 2,
          }}
          accessibilityLabel={h.filterLabel}
        >
          {TABS.map(({ value, label }) => {
            const selected = value === tab;
            return (
              <Pressable
                key={value}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setTab(value)}
                style={{
                  flex: 1,
                  height: 36,
                  borderRadius: theme.radius.pill,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: selected ? theme.color.brand : 'transparent',
                }}
              >
                <Text
                  variant="caption"
                  style={{
                    fontWeight: '600',
                    color: selected ? theme.color.onBrand : theme.color.text,
                  }}
                >
                  {h[label]}
                </Text>
              </Pressable>
            );
          })}
        </Row>
        {groups.map(({ label, items }) =>
          items.length ? (
            <View key={label} style={{ gap: theme.spacing.xs }}>
              <Text
                accessibilityRole="header"
                variant="caption"
                tone="muted"
                style={{ fontWeight: '700', paddingHorizontal: theme.spacing.xs }}
              >
                {label}
              </Text>
              <View
                style={{
                  borderRadius: theme.radius.lg,
                  borderWidth: 1,
                  borderColor: theme.color.border,
                  backgroundColor: theme.color.surface,
                  overflow: 'hidden',
                }}
              >
                {items.map(render)}
              </View>
            </View>
          ) : null,
        )}
        {!rows.length ? (
          <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
            {h.upcomingEmpty}
          </Text>
        ) : null}
      </ScrollView>
      <Sheet visible={acting !== null} onClose={() => setActing(null)} closeLabel={t.common.close}>
        {acting ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Row style={{ gap: theme.spacing.md, marginBottom: theme.spacing.sm }}>
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: theme.radius.lg,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.color.brandSoft,
                }}
              >
                <Ionicons name={acting.icon} size={iconSize.xl} color={theme.color.brand} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="heading" numberOfLines={2}>
                  {acting.title}
                </Text>
                <Row style={{ gap: 4 }}>
                  <Ionicons
                    name="calendar-outline"
                    size={iconSize.sm}
                    color={theme.color.textMuted}
                  />
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    {acting.subtitle}
                  </Text>
                </Row>
              </View>
              <Badge label={acting.status} tone={acting.overdue ? 'negative' : 'brand'} />
            </Row>
            <Button
              icon={
                <Ionicons
                  name="checkmark-circle-outline"
                  size={iconSize.md}
                  color={theme.color.onBrand}
                />
              }
              label={acting.rule.txnKind === 'income' ? t.personal.postNow : h.markPaid}
              disabled={posting}
              onPress={() => {
                const { rule, date } = acting;
                setActing(null);
                void post(rule, date);
              }}
            />
            <Button
              variant="secondary"
              icon={<Ionicons name="create-outline" size={iconSize.md} color={theme.color.brand} />}
              label={h.editBill}
              onPress={() => {
                const id = acting.rule.id;
                setActing(null);
                router.push({ pathname: '/personal/entry', params: { recurringId: id } });
              }}
            />
          </View>
        ) : null}
      </Sheet>
      <AddReminderSheet
        visible={adding}
        currency={currency}
        today={today}
        onClose={() => setAdding(false)}
      />
    </View>
  );
}
