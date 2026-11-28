/** The money calendar: a month grid with coloured dots, filter chips and the month's items with a quick action. */

import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Ionicons from '@expo/vector-icons/Ionicons';
import { directionalIcon, iconSize, Row, Screen, Text, useTheme } from '@waves/ui';

import { addBillRoute, tagColor, useDueMoney, useTagText } from '@/components/home/ComingUpHome';
import { MonthSwitcher, StandardCard } from '@/components/standard';
import { useComingUp } from '@/data/useComingUp';
import { useMarkBillPaid } from '@/data/groupRecurring';
import { usePostRecurring } from '@/data/postRecurring';
import { plural, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';
import { firstWeekday } from '@/lib/calendarGrid';
import { shiftMonth } from '@/lib/monthNav';
import {
  expandDue,
  dueTag,
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
  const insets = useSafeAreaInsets();
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
  const weekStart = useMemo(() => firstWeekday(locale), [locale]);
  const grid = useMemo(
    () => monthGrid(month, monthItems, weekStart),
    [month, monthItems, weekStart],
  );
  const selected = picked ?? (month === current ? today : `${month}-01`);
  const filtered = filterItems(monthItems, filter);
  const shown = filtered.filter((i) => i.date === selected);
  const dayTotal = shown.reduce((n, i) => (i.currency === dc ? n + i.amount : n), 0n);
  const tagText = useTagText();
  const weekdays = useMemo(() => {
    const fmtDay = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
    return Array.from({ length: 7 }, (_, i) =>
      fmtDay.format(new Date(Date.UTC(2023, 0, 1 + ((weekStart + i) % 7)))),
    );
  }, [locale, weekStart]);
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
  const chips: { value: DueFilter; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { value: 'all', label: `${c.filterAll} (${monthItems.length})`, icon: 'layers-outline' },
    { value: 'bills', label: c.filterBills, icon: 'document-text-outline' },
    { value: 'loans', label: c.filterLoans, icon: 'cash-outline' },
    { value: 'renewals', label: c.filterRenewals, icon: 'refresh-outline' },
    { value: 'income', label: c.filterIncome, icon: 'download-outline' },
  ];
  const kindIcon: Record<DueKind, keyof typeof Ionicons.glyphMap> = {
    bill: 'document-text-outline',
    loan: 'cash-outline',
    renewal: 'refresh-outline',
    income: 'download-outline',
    rent: 'storefront-outline',
  };
  const kindSoft = (k: DueKind): string =>
    k === 'loan'
      ? theme.color.warningSoft
      : k === 'income' || k === 'rent'
        ? theme.color.positiveSoft
        : k === 'renewal'
          ? theme.color.brandSoft
          : theme.color.negativeSoft;

  return (
    <Screen edges={[]}>
      <Row
        style={{
          alignItems: 'center',
          gap: theme.spacing.md,
          paddingTop: insets.top + theme.spacing.sm,
          paddingBottom: theme.spacing.md,
          paddingHorizontal: theme.spacing.lg,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.common.back}
          onPress={() => router.back()}
          hitSlop={6}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.surface,
            borderWidth: 1,
            borderColor: theme.color.border,
          }}
        >
          <Ionicons
            name={directionalIcon('arrow-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="heading" style={{ fontWeight: '800' }}>
            {c.calendarTitle}
          </Text>
          <Text variant="caption" tone="muted">
            {c.calendarSub}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={c.addDueDate}
          onPress={() => router.push(addBillRoute(groupId))}
          hitSlop={6}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.brand,
          }}
        >
          <Ionicons name="add" size={iconSize.lg} color={theme.color.onBrand} />
        </Pressable>
      </Row>
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
            pill
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
                numberOfLines={1}
                style={{ flex: 1, textAlign: 'center', fontWeight: '600' }}
              >
                {w}
              </Text>
            ))}
          </Row>
          <View>
            {gridRows(grid).map((week, w) => (
              <Row key={w}>
                {week.map((cell, i) => {
                  const on = selected === cell?.date;
                  return (
                    <View key={i} style={{ flex: 1, padding: 2 }}>
                      {cell ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          accessibilityLabel={`${cell.day}, ${cell.kinds.length} ${c.calendarTitle}`}
                          onPress={() => setPicked(cell.date)}
                          style={{
                            height: 46,
                            borderRadius: 12,
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 3,
                            backgroundColor: on
                              ? theme.color.brand
                              : cell.date === today
                                ? theme.color.brandSoft
                                : 'transparent',
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 15,
                              fontWeight: on || cell.kinds.length > 0 ? '700' : '500',
                              color: on ? theme.color.onBrand : theme.color.text,
                            }}
                          >
                            {cell.day}
                          </Text>
                          <View
                            style={{
                              width: 5,
                              height: 5,
                              borderRadius: 3,
                              backgroundColor:
                                cell.kinds.length > 0
                                  ? on
                                    ? theme.color.onBrand
                                    : theme.color.brand
                                  : 'transparent',
                            }}
                          />
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
              </Row>
            ))}
          </View>
        </StandardCard>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Row style={{ gap: theme.spacing.sm }}>
            {chips.map((ch) => {
              const on = filter === ch.value;
              const fg = on ? theme.color.onBrand : theme.color.text;
              return (
                <Pressable
                  key={ch.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => setFilter(ch.value)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingHorizontal: 14,
                    height: 40,
                    borderRadius: 20,
                    backgroundColor: on ? theme.color.brand : theme.color.surface,
                    borderWidth: 1,
                    borderColor: on ? theme.color.brand : theme.color.border,
                  }}
                >
                  <Ionicons
                    name={ch.icon}
                    size={iconSize.md}
                    color={on ? fg : ch.value === 'income' ? theme.color.positive : fg}
                  />
                  <Text style={{ fontWeight: '600', color: fg }}>{ch.label}</Text>
                </Pressable>
              );
            })}
          </Row>
        </ScrollView>

        <StandardCard style={{ gap: theme.spacing.md }}>
          <Row style={{ alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ flexShrink: 1, fontWeight: '800', fontSize: 16 }}>
              {new Intl.DateTimeFormat(locale, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                timeZone: 'UTC',
              }).format(new Date(`${selected}T00:00:00Z`))}
            </Text>
            <Text variant="caption" tone="muted" style={{ flexShrink: 0 }}>
              {plural(locale, shown.length, c.dayItems).replace('{n}', String(shown.length))}
              {' \u2022 '}
              <Text variant="caption" style={{ fontWeight: '800' }}>
                {fmt(dayTotal)}
              </Text>
            </Text>
          </Row>
          {shown.length === 0 ? (
            <Text tone="muted">{c.nothingThisMonth}</Text>
          ) : (
            shown.map((item) => {
              const action = item.amount > 0n || item.kind === 'renewal' ? actionFor(item) : null;
              const tag = dueTag(item);
              return (
                <Pressable
                  key={item.key}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title}, ${fmt(item.amount)}, ${tagText(item, tag)}`}
                  onPress={() => router.push(item.href as never)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.sm,
                    padding: theme.spacing.sm,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: theme.color.border,
                  }}
                >
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: kindSoft(item.kind),
                    }}
                  >
                    <Ionicons
                      name={kindIcon[item.kind]}
                      size={iconSize.lg}
                      color={dotColor(theme, item.kind)}
                    />
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text style={{ fontWeight: '700' }}>{item.title}</Text>
                    <Row style={{ alignItems: 'center', gap: 4 }}>
                      <Ionicons name="repeat-outline" size={14} color={theme.color.textMuted} />
                      <Text variant="caption" tone="muted" style={{ flexShrink: 1 }}>
                        {item.sub}
                      </Text>
                    </Row>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text
                      style={{
                        fontWeight: '800',
                        color: item.income ? theme.color.positive : theme.color.text,
                      }}
                    >
                      {item.amount <= 0n ? '' : `${item.income ? '+' : ''}${fmt(item.amount)}`}
                    </Text>
                    <View
                      style={{
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                        borderRadius: 8,
                        backgroundColor:
                          tag === 'overdue' ? theme.color.negativeSoft : theme.color.surfaceMuted,
                      }}
                    >
                      <Text
                        variant="micro"
                        style={{
                          fontWeight: '700',
                          color:
                            tag === 'overdue' ? theme.color.negativeText : tagColor(theme, tag),
                        }}
                      >
                        {tagText(item, tag)}
                      </Text>
                    </View>
                  </View>
                  {action ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${actionLabel[action]}, ${item.title}`}
                      onPress={() => run(item)}
                      hitSlop={6}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 4,
                        paddingHorizontal: 10,
                        paddingVertical: 8,
                        borderRadius: 12,
                        backgroundColor: theme.color.brandSoft,
                      }}
                    >
                      {action === 'remind' ? (
                        <Ionicons
                          name="notifications-outline"
                          size={iconSize.md}
                          color={theme.color.brand}
                        />
                      ) : null}
                      <Text variant="caption" tone="brand" style={{ fontWeight: '700' }}>
                        {actionLabel[action]}
                      </Text>
                    </Pressable>
                  ) : null}
                </Pressable>
              );
            })
          )}
        </StandardCard>
      </ScrollView>
    </Screen>
  );
}
