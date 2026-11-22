/**
 * Upcoming & Reminders in full: filter pills, two summary cards, this month's
 * bills (switchable month), the next month's, and the setup to-do.
 */

import { useState, type ReactNode } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';

import { format, frequencyOf, money, pickUpcoming, type PersonalRecurring } from '@waves/core';
import {
  Button,
  directionalIcon,
  iconSize,
  Row,
  Sheet,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { CategoryBadge } from '@/components/Category';
import { BALANCE_MASK } from '@/components/home/HomeBalanceCard';
import { useSetupLeft } from '@/components/PersonalSetupCard';
import { AddReminderSheet } from '@/components/personal/AddReminderSheet';
import { ICON_FOR } from '@/components/personal/PersonalHomeParts';
import { PlainHeader, StandardCard } from '@/components/standard';
import { todayIso, usePersonalLedger } from '@/data/personal';
import { useDateOccurrences } from '@/data/personalDates';
import { usePostRecurring } from '@/data/postRecurring';
import { fill, plural, useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { usePersonalAmountsHidden } from '@/lib/amountsHidden';
import { useDefaultCurrency } from '@/lib/currency';
import { dateTimeFormat } from '@/lib/dateTimeFormat';
import { actionFor } from '@/lib/dateReminders/actions';
import { subtitleOf, titleOf } from '@/lib/dateReminders/text';
import { useRunDateAction } from '@/lib/dateReminders/useRunDateAction';
import { frequencyLabel } from '@/lib/frequencyLabel';
import { router } from '@/lib/navigation';
import {
  dateRows,
  monthOptions,
  recurringRows,
  upcomingView,
  visibleSections,
  type SummaryFilter,
  type UpcomingRow,
  type UpcomingTab,
} from '@/lib/personalUpcoming';
import { nextDateLabel } from '@/lib/recurringList';

const TABS: { value: UpcomingTab; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'all', icon: 'calendar-outline' },
  { value: 'bills', icon: 'receipt-outline' },
  { value: 'todo', icon: 'checkbox-outline' },
  { value: 'recurring', icon: 'sync-outline' },
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
  const left = useSetupLeft();
  const runDateAction = useRunDateAction();
  const { post, isPending: posting } = usePostRecurring();

  const [today] = useState(() => todayIso());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [tab, setTab] = useState<UpcomingTab>('all');
  const [card, setCard] = useState<SummaryFilter>(null);
  const [monthSheet, setMonthSheet] = useState(false);
  const [adding, setAdding] = useState(false);
  const [acting, setActing] = useState<{ rule: PersonalRecurring; date: string } | null>(null);

  const view = upcomingView({
    txns: ledger.txns,
    recurrings: ledger.recurrings,
    currency,
    today,
    month,
    dates: dateRows(session && !isGuest ? pickUpcoming(occurrences, 50) : []),
    todoLeft: left.length,
  });
  const shown = visibleSections(view, tab, card);
  const recurring =
    tab === 'recurring' && !card ? recurringRows(ledger.recurrings, currency, today) : [];

  const fmt = (amount: bigint, cur: string): string =>
    hidden ? BALANCE_MASK : format(money(amount, cur), { locale, trimZeros: true });
  const count = (n: number): string => (hidden ? '' : ` (${n})`);
  const dayName = (iso: string): string => {
    try {
      return dateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
        new Date(`${iso}T00:00:00Z`),
      );
    } catch {
      return iso;
    }
  };
  const monthName = (m: string): string => {
    try {
      return dateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(`${m}-01T00:00:00Z`),
      );
    } catch {
      return m;
    }
  };
  const ruleOf = (row: UpcomingRow) => ledger.recurrings.find((r) => r.id === row.ruleId);

  const pillFor = (row: UpcomingRow): { text: string; negative: boolean } | null =>
    row.kind === 'todo'
      ? null
      : row.overdue
        ? { text: h.overdue, negative: true }
        : row.inDays < 0
          ? { text: h.overdue, negative: true }
          : {
              text: row.inDays === 0 ? h.today : plural(locale, row.inDays, h.inDays),
              negative: false,
            };

  const renderRow = (row: UpcomingRow, i: number, rows: readonly UpcomingRow[], todo = false) => {
    const last = i === rows.length - 1;
    const item = row.item;
    const rule = ruleOf(row);
    let title: string;
    let subtitle: string;
    let lead: ReactNode;
    let onPress: () => void;
    if (row.kind === 'todo') {
      title = h.todo;
      subtitle = plural(locale, row.left ?? 0, h.itemsLeft);
      lead = <Disc icon="checkbox-outline" tone="warning" />;
      onPress = () =>
        router.push({ pathname: '/personal/setup', params: left[0] ? { step: left[0] } : {} });
    } else if (item) {
      title = titleOf(item, t.dates);
      subtitle = subtitleOf(item, t.dates, locale);
      lead = (
        <Disc icon={ICON_FOR[item.kind] ?? 'calendar-outline'} tone={todo ? 'warning' : row.tone} />
      );
      onPress = () =>
        actionFor(item)
          ? runDateAction(item)
          : item.source === 'date'
            ? router.push({ pathname: '/dates/edit', params: { id: item.id } })
            : router.push('/dates');
    } else {
      title = row.title || t.personal.expense;
      subtitle = row.income
        ? `${frequencyLabel(t, frequencyOf(rule!), rule!.interval)} · ${t.personal.nextDue} ${nextDateLabel(row.date ?? '', locale)}`
        : fill(row.overdue ? h.dueOverdue : h.dueOn, { date: dayName(row.date ?? '') });
      lead = row.income ? (
        <Disc icon="arrow-down-outline" tone="positive" />
      ) : (
        <CategoryBadge category={row.category} size={36} />
      );
      onPress = () => rule && setActing({ rule, date: row.date ?? rule.nextDate });
    }
    const pill = pillFor(row);
    const tone = row.overdue ? theme.color.negative : theme.color.brand;
    return (
      <Pressable
        key={row.key}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${subtitle}${pill ? `, ${pill.text}` : ''}`}
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          minHeight: 52,
          paddingVertical: theme.spacing.xs,
          paddingHorizontal: theme.spacing.sm,
          borderRadius: theme.radius.md,
          backgroundColor: row.overdue
            ? theme.color.negativeSoft
            : todo
              ? theme.color.warningSoft
              : 'transparent',
          borderStartWidth: todo ? 3 : 0,
          borderStartColor: theme.color.warning,
          borderBottomWidth: last || row.overdue || todo ? 0 : 1,
          borderBottomColor: theme.color.border,
          marginBottom: row.overdue || todo ? 4 : 0,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        {lead}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontWeight: '700' }}>
            {title}
          </Text>
          <Text
            variant="caption"
            numberOfLines={1}
            style={{ color: row.overdue ? theme.color.negative : theme.color.textMuted }}
          >
            {subtitle}
          </Text>
        </View>
        {row.amount !== undefined && row.currency ? (
          <Text numberOfLines={1} style={{ fontWeight: '700' }}>
            {fmt(row.amount, row.currency)}
          </Text>
        ) : null}
        {pill ? (
          <View
            style={{
              borderRadius: theme.radius.pill,
              backgroundColor: pill.negative ? theme.color.negativeSoft : theme.color.brandSoft,
              paddingHorizontal: theme.spacing.sm,
              paddingVertical: 2,
            }}
          >
            <Text
              variant="micro"
              numberOfLines={1}
              style={{ color: pill.negative ? theme.color.negative : tone, fontWeight: '700' }}
            >
              {pill.text}
            </Text>
          </View>
        ) : null}
        <Ionicons
          name={directionalIcon('chevron-forward')}
          size={iconSize.sm}
          color={theme.color.textMuted}
        />
      </Pressable>
    );
  };

  const toggleCard = (next: Exclude<SummaryFilter, null>) => setCard(card === next ? null : next);
  const empty =
    shown.month.length + shown.next.length + shown.todos.length + recurring.length === 0;

  return (
    <View style={{ flex: 1 }}>
      <PlainHeader title={h.upcomingTitle} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance + theme.spacing.lg,
          gap: theme.spacing.md,
        }}
      >
        <Row
          accessibilityLabel={h.filterLabel}
          style={{
            backgroundColor: theme.color.surface,
            borderRadius: theme.radius.pill,
            padding: 4,
            gap: 2,
          }}
        >
          {TABS.map(({ value, icon }) => {
            const on = tab === value && !card;
            const n = value === 'recurring' ? '' : count(view.counts[value]);
            const label = {
              all: h.filterAll,
              bills: h.filterBills,
              todo: h.filterTodo,
              recurring: h.filterRecurring,
            }[value];
            return (
              <Pressable
                key={value}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${label}${n}`}
                onPress={() => {
                  setTab(value);
                  setCard(null);
                }}
                style={{
                  flex: on ? 1.3 : 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  height: 36,
                  borderRadius: theme.radius.pill,
                  backgroundColor: on ? theme.color.brand : 'transparent',
                }}
              >
                <Ionicons
                  name={icon}
                  size={iconSize.sm}
                  color={on ? theme.color.onBrand : theme.color.textMuted}
                />
                <Text
                  variant="caption"
                  numberOfLines={1}
                  style={{
                    fontWeight: '600',
                    flexShrink: 1,
                    color: on ? theme.color.onBrand : theme.color.text,
                  }}
                >
                  {`${label}${n}`}
                </Text>
              </Pressable>
            );
          })}
        </Row>

        <Row style={{ gap: theme.spacing.sm }}>
          <SummaryCard
            icon="calendar-outline"
            tone="brand"
            label={h.dueThisMonth}
            amount={fmt(view.totals.due, currency)}
            sub={hidden ? BALANCE_MASK : plural(locale, view.totals.dueCount, h.billsCount)}
            selected={card === 'month'}
            onPress={() => toggleCard('month')}
          />
          <SummaryCard
            icon="warning-outline"
            tone="negative"
            label={h.overdue}
            amount={fmt(view.totals.overdue, currency)}
            sub={hidden ? BALANCE_MASK : plural(locale, view.totals.overdueCount, h.itemsCount)}
            selected={card === 'overdue'}
            onPress={() => toggleCard('overdue')}
          />
        </Row>

        {tab === 'recurring' && !card ? (
          <StandardCard>{recurring.map((row, i) => renderRow(row, i, recurring))}</StandardCard>
        ) : null}

        {shown.month.length + shown.next.length > 0 || (tab !== 'todo' && tab !== 'recurring') ? (
          <StandardCard>
            <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Text accessibilityRole="header" variant="subheading">
                {h.thisMonth}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${h.pickMonth}: ${monthName(month)}`}
                onPress={() => setMonthSheet(true)}
                hitSlop={8}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
              >
                <Text variant="caption" tone="brand" style={{ fontWeight: '600' }}>
                  {monthName(month)}
                </Text>
                <Ionicons name="chevron-down" size={iconSize.sm} color={theme.color.brand} />
              </Pressable>
            </Row>
            <View style={{ marginTop: theme.spacing.sm }}>
              {shown.month.map((r, i) => renderRow(r, i, shown.month))}
              {shown.month.length === 0 ? (
                <Text variant="caption" tone="muted">
                  {h.nothingHere}
                </Text>
              ) : null}
              {shown.next.length > 0 ? (
                <>
                  <Text
                    accessibilityRole="header"
                    style={{ fontWeight: '700', marginTop: theme.spacing.md }}
                  >
                    {h.nextSection}
                  </Text>
                  {shown.next.map((r, i) => renderRow(r, i, shown.next))}
                </>
              ) : null}
            </View>
          </StandardCard>
        ) : null}

        {shown.todos.length > 0 ? (
          <StandardCard>
            {shown.todos.map((r, i) => renderRow(r, i, shown.todos, true))}
          </StandardCard>
        ) : null}
        {empty ? (
          <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
            {h.upcomingEmpty}
          </Text>
        ) : null}

        <Row style={{ gap: theme.spacing.sm, justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Button label={`+ ${h.addReminder}`} fullWidth onPress={() => setAdding(true)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              variant="secondary"
              fullWidth
              label={t.dates.addDate}
              onPress={() => router.push('/dates/edit')}
            />
          </View>
        </Row>
      </ScrollView>

      <Sheet visible={monthSheet} onClose={() => setMonthSheet(false)} closeLabel={t.common.close}>
        <View style={{ gap: theme.spacing.xs }}>
          <Text variant="title">{h.pickMonth}</Text>
          {monthOptions(today).map((m) => (
            <Button
              key={m}
              variant={m === month ? 'primary' : 'ghost'}
              label={monthName(m)}
              onPress={() => {
                setMonth(m);
                setMonthSheet(false);
              }}
            />
          ))}
        </View>
      </Sheet>

      <Sheet visible={acting !== null} onClose={() => setActing(null)} closeLabel={t.common.close}>
        {acting ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="heading">{acting.rule.note?.trim() || t.personal.expense}</Text>
            <Button
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

function Disc({
  icon,
  tone,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: 'brand' | 'positive' | 'negative' | 'warning';
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: theme.color[`${tone}Soft` as 'brandSoft'],
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={icon} size={iconSize.md} color={theme.color[tone]} />
    </View>
  );
}

function SummaryCard({
  icon,
  tone,
  label,
  amount,
  sub,
  selected,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: 'brand' | 'negative';
  label: string;
  amount: string;
  sub: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}, ${amount}, ${sub}`}
      onPress={onPress}
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        padding: theme.spacing.sm + 2,
        borderRadius: theme.radius.lg,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.color[tone] : theme.color.border,
        backgroundColor: theme.color.surface,
      }}
    >
      <Disc icon={icon} tone={tone} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="micro" tone="muted" numberOfLines={1}>
          {label}
        </Text>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={{
            fontWeight: '800',
            fontSize: 17,
            color: tone === 'negative' ? theme.color.negative : theme.color.text,
          }}
        >
          {amount}
        </Text>
        <Text variant="micro" tone="muted" numberOfLines={1}>
          {sub}
        </Text>
      </View>
      <Ionicons
        name={directionalIcon('chevron-forward')}
        size={iconSize.sm}
        color={theme.color.textMuted}
      />
    </Pressable>
  );
}
