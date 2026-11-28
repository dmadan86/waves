import { useEffect, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeOut, LinearTransition } from 'react-native-reanimated';

import { format, money, pickUpcoming } from '@waves/core';
import {
  Badge,
  Button,
  IconButton,
  iconSize,
  Row,
  Sheet,
  Text,
  useTabBarClearance,
  useTheme,
} from '@waves/ui';

import { BALANCE_MASK } from '@/components/home/HomeBalanceCard';
import { GroupRow } from '@/components/home/GroupRow';
import { EmptyStateCta } from '@/components/EmptyStateCta';
import { AddReminderSheet } from '@/components/personal/AddReminderSheet';
import { ICON_FOR, useWealthRows } from '@/components/personal/PersonalHomeParts';
import { ListCard, PlainHeader, RowTile } from '@/components/standard';
import { RaiseCard } from '@/components/wealth/RaiseCard';
import { todayIso, usePersonalLedger } from '@/data/personal';
import { useDateOccurrences } from '@/data/personalDates';
import { usePostRecurring } from '@/data/postRecurring';
import { plural, useStrings } from '@/i18n';
import { SlidingHighlight } from '@/lib/SlidingHighlight';
import { useAuth } from '@/lib/auth';
import { usePersonalAmountsHidden } from '@/lib/amountsHidden';
import { useDefaultCurrency } from '@/lib/currency';
import { actionFor } from '@/lib/dateReminders/actions';
import { subtitleOf, titleOf } from '@/lib/dateReminders/text';
import { useRunDateAction } from '@/lib/dateReminders/useRunDateAction';
import { router } from '@/lib/navigation';
import { useReducedMotion } from '@/lib/reducedMotion';
import {
  dateRows,
  filterUpcoming,
  groupUpcoming,
  upcomingView,
  type UpcomingTab,
  type UpcomingRow,
} from '@/lib/personalUpcoming';
import { nextDateLabel } from '@/lib/recurringList';
import { shouldAnimatePostedLayout } from '@/lib/rentalExtrasBehavior';

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
  const reduce = useReducedMotion();
  const [rowWidth, setRowWidth] = useState(0);
  // The row that was just marked paid: only it fades out, and only now do the others glide up.
  const [postedKey, setPostedKey] = useState<string | null>(null);
  const clearPosted = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (clearPosted.current) clearTimeout(clearPosted.current);
    },
    [],
  );
  const [acting, setActing] = useState<{
    rule: (typeof ledger.recurrings)[number];
    date: string;
    title: string;
    subtitle: string;
    key: string;
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
      <Animated.View
        key={row.key}
        exiting={!reduce && postedKey === row.key ? FadeOut.duration(160) : undefined}
        layout={
          !reduce && shouldAnimatePostedLayout(postedKey)
            ? LinearTransition.springify().damping(24).stiffness(220)
            : undefined
        }
      >
        <GroupRow
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
                key: row.key,
                title,
                subtitle,
                icon,
                status: dateLabel,
                overdue: row.inDays < 0,
              });
          }}
        />
      </Animated.View>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <PlainHeader
        title={h.upcomingTitle}
        trailing={
          <Row style={{ gap: theme.spacing.xs }}>
            {/* Birthdays, anniversaries and festival switches live here (moved out of Settings). */}
            <IconButton label={t.dates.title} onPress={() => router.push('/dates')}>
              <Ionicons name="calendar-outline" size={iconSize.lg} color={theme.color.brand} />
            </IconButton>
            {view.rows.length > 0 ? (
              <IconButton label={h.addReminder} onPress={() => setAdding(true)}>
                <Ionicons name="add" size={iconSize.xl} color={theme.color.brand} />
              </IconButton>
            ) : null}
          </Row>
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
          onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}
        >
          <SlidingHighlight
            index={Math.max(
              0,
              TABS.findIndex((x) => x.value === tab),
            )}
            count={TABS.length}
            width={rowWidth}
            color={theme.color.brand}
            radius={theme.radius.pill}
            inset={4}
            gap={2}
            height={36}
          />
          {TABS.map(({ value, label }) => {
            const selected = value === tab;
            return (
              <Pressable
                key={value}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => {
                  setTab(value);
                  setPostedKey(null);
                  if (clearPosted.current) clearTimeout(clearPosted.current);
                }}
                style={{
                  flex: 1,
                  height: 36,
                  borderRadius: theme.radius.pill,
                  alignItems: 'center',
                  justifyContent: 'center',
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
              <ListCard>{items.map(render)}</ListCard>
            </View>
          ) : null,
        )}
        {!rows.length ? (
          view.rows.length === 0 ? (
            <EmptyStateCta
              compact
              title={h.upcomingTitle}
              body={h.upcomingEmpty}
              action={h.addReminder}
              onAdd={() => setAdding(true)}
            />
          ) : (
            <View style={{ alignItems: 'center', gap: theme.spacing.sm }}>
              <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
                No entries match these filters
              </Text>
              <Button label="Clear filters" variant="ghost" onPress={() => setTab('all')} />
            </View>
          )
        ) : null}
      </ScrollView>
      <Sheet visible={acting !== null} onClose={() => setActing(null)} closeLabel={t.common.close}>
        {acting ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Row style={{ gap: theme.spacing.md, marginBottom: theme.spacing.sm }}>
              <RowTile tint={theme.color.brandSoft}>
                <Ionicons name={acting.icon} size={iconSize.lg} color={theme.color.brand} />
              </RowTile>
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
              fullWidth
              disabled={posting}
              onPress={() => {
                const { rule, date, key } = acting;
                setActing(null);
                setPostedKey(key);
                if (clearPosted.current) clearTimeout(clearPosted.current);
                clearPosted.current = setTimeout(() => setPostedKey(null), 1500);
                void post(rule, date);
              }}
            />
            <Button
              variant="secondary"
              icon={<Ionicons name="create-outline" size={iconSize.md} color={theme.color.brand} />}
              label={h.editBill}
              fullWidth
              onPress={() => {
                const id = acting.rule.id;
                setActing(null);
                router.push({ pathname: '/personal/entry', params: { recurringId: id } });
              }}
            />
            <Button
              variant="secondary"
              icon={<Ionicons name="time-outline" size={iconSize.md} color={theme.color.brand} />}
              label={t.personal.seeHistory}
              fullWidth
              onPress={() => {
                const id = acting.rule.id;
                setActing(null);
                router.push(`/personal/source/${id}`);
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
