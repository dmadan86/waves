/**
 * The four tabs of the household home. Each takes the one `HouseholdData` the
 * screen builds, so they stay plain views: Overview, Bills, Upcoming and Income. Amounts honour the eye (`data.fmt` masks when hidden).
 */
import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import {
  billsMonthlyTotal,
  recurringDisplayStatus,
  resolveCategory,
  type GroupRecurringRule,
  type HouseholdUpcoming,
} from '@waves/core';
import { Card, directionalIcon, iconSize, Row, Text, useTheme } from '@waves/ui';

import { CategoryBadge } from '@/components/Category';
import { AddFamilyMember } from '@/components/household/HouseholdParts';
import { BudgetSummary } from '@/components/home/MonthParts';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { PersonAvatar } from '@/components/PersonAvatar';
import { GroupRow } from '@/components/home/GroupRow';
import { CardTitle, PrivacyPill } from '@/components/personal/PersonalHomeParts';
import { useUpdateGroupRecurring } from '@/data/groupRecurring';
import type { IncomePlan } from '@/data/groupIncome';
import { expenseTitle } from '@/data/expenseTitle';
import type { ExpenseRow } from '@/data/types';
import { fill, plural, useStrings } from '@/i18n';
import { billPayer } from '@/lib/householdHome';
import { useDialog } from '@/lib/dialog';
import { friendlyError } from '@/lib/errors';
import { router } from '@/lib/navigation';

export interface HouseholdData {
  readonly groupId: string;
  readonly currency: string;
  readonly hidden: boolean;
  readonly fmt: (minor: bigint) => string;
  readonly nameOf: (memberId: string | null) => string;
  readonly isGhostMember: (memberId: string) => boolean;
  readonly rules: readonly GroupRecurringRule[];
  readonly plans: readonly IncomePlan[];
  readonly upcoming: readonly HouseholdUpcoming[];
  readonly spent: bigint;
  readonly income: bigint;
  /** The monthly ceiling: the household budget, else the planned income. */
  readonly limit: bigint | null;
  readonly recent: readonly ExpenseRow[];
  /** The month pill that sits in the "This month" card title. */
  readonly monthPill?: React.ReactNode;
  /** Per-day allowance left in the month's budget (0 for a past month). */
  readonly perDay: bigint;
  /** What the live bills cost in an average month. */
  readonly billsMonthly: bigint;
  /** Post one bill occurrence as a group expense; the row goes once it is paid. */
  readonly onMarkPaid: (row: HouseholdUpcoming) => Promise<void>;
  readonly onTab: (tab: 'bills' | 'income' | 'upcoming') => void;
  readonly onMore: () => void;
  readonly onLedger: (tab?: 'balances') => void;
}

const gap = 'md' as const;

function Pill({ text, tone }: { text: string; tone: 'brand' | 'negative' | 'warning' }) {
  const theme = useTheme();
  const soft = theme.color[`${tone}Soft` as 'brandSoft'];
  return (
    <View
      style={{
        borderRadius: theme.radius.pill,
        backgroundColor: soft,
        paddingHorizontal: theme.spacing.sm,
        paddingVertical: 2,
      }}
    >
      <Text
        variant="micro"
        numberOfLines={1}
        style={{ color: theme.color[tone], fontWeight: '700' }}
      >
        {text}
      </Text>
    </View>
  );
}

function AddRow({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{ minHeight: 44, justifyContent: 'center' }}
    >
      <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
        <Ionicons name="add" size={iconSize.md} color={theme.color.brand} />
        <Text tone="brand" style={{ fontWeight: '600' }}>
          {label}
        </Text>
      </Row>
    </Pressable>
  );
}

/** "In 3 days" / "Today" / "Overdue", the Personal home's pills. */
function useWhenText(): (inDays: number) => string {
  const { t, locale } = useStrings();
  return (inDays) =>
    inDays < 0
      ? t.personalHome.overdue
      : inDays === 0
        ? t.personalHome.today
        : plural(locale, inDays, t.personalHome.inDays);
}

function UpcomingRowView({
  row,
  data,
  last,
}: {
  row: HouseholdUpcoming;
  data: HouseholdData;
  last: boolean;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const whenText = useWhenText();
  const [busy, setBusy] = useState(false);
  const tone = row.inDays < 0 ? 'negative' : 'brand';
  const ink = theme.color[tone];
  const soft = theme.color[`${tone}Soft` as 'brandSoft'];
  const day = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${row.date}T00:00:00Z`));
  const subtitle = row.payerId
    ? fill(t.household.billPays, { name: data.nameOf(row.payerId), when: day })
    : day;
  const pill = whenText(row.inDays);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.title}, ${subtitle}, ${data.fmt(row.amount)}, ${pill}`}
      onPress={() => router.push(`/group/${data.groupId}/recurring-edit?ruleId=${row.ruleId}`)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        minHeight: 52,
        paddingVertical: theme.spacing.xs,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: theme.color.border,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: ink }} />
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: theme.radius.md,
          backgroundColor: soft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name="receipt-outline" size={iconSize.md} color={ink} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontWeight: '700' }}>
          {row.title}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {subtitle}
        </Text>
        {row.kind === 'bill' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t.hhome.markPaid}, ${row.title}`}
            accessibilityState={{ busy }}
            disabled={busy}
            hitSlop={8}
            onPress={() => {
              setBusy(true);
              data.onMarkPaid(row).catch(() => setBusy(false));
            }}
            style={{ alignSelf: 'flex-start', paddingVertical: 4, opacity: busy ? 0.5 : 1 }}
          >
            <Text variant="caption" tone="brand" style={{ fontWeight: '700' }}>
              {t.hhome.markPaid}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Text numberOfLines={1} style={{ fontWeight: '700' }}>
        {data.fmt(row.amount)}
      </Text>
      <Pill text={pill} tone={row.inDays < 0 ? 'negative' : 'brand'} />
    </Pressable>
  );
}

function UpcomingList({ rows, data }: { rows: readonly HouseholdUpcoming[]; data: HouseholdData }) {
  const { t } = useStrings();
  if (rows.length === 0)
    return (
      <Text variant="caption" tone="muted">
        {t.hhome.upcomingEmpty}
      </Text>
    );
  return (
    <View>
      {rows.map((row, i) => (
        <UpcomingRowView key={row.key} row={row} data={data} last={i === rows.length - 1} />
      ))}
    </View>
  );
}

/** The home card's rows: the shared GroupRow, as the Personal Upcoming card draws them. */
function UpcomingCardRows({
  rows,
  data,
}: {
  rows: readonly HouseholdUpcoming[];
  data: HouseholdData;
}) {
  const { t, locale } = useStrings();
  const whenText = useWhenText();
  const theme = useTheme();
  if (rows.length === 0)
    return (
      <Text variant="caption" tone="muted">
        {t.hhome.upcomingEmpty}
      </Text>
    );
  return (
    <View>
      {rows.map((row, i) => {
        const day = new Intl.DateTimeFormat(locale, {
          day: 'numeric',
          month: 'short',
          timeZone: 'UTC',
        }).format(new Date(`${row.date}T00:00:00Z`));
        return (
          <GroupRow
            key={row.key}
            title={row.title}
            memberLabel={
              row.payerId
                ? fill(t.household.billPays, { name: data.nameOf(row.payerId), when: day })
                : day
            }
            amountText={data.fmt(row.amount)}
            chevron
            directionLabel={whenText(row.inDays)}
            directionTone={row.inDays < 0 ? 'negative' : 'muted'}
            locale={locale}
            divider={i < rows.length - 1}
            icon="receipt-outline"
            iconColor={row.inDays < 0 ? theme.color.negative : theme.color.brand}
            tone={row.inDays < 0 ? 'negative' : undefined}
            onPress={() =>
              router.push(`/group/${data.groupId}/recurring-edit?ruleId=${row.ruleId}`)
            }
          />
        );
      })}
    </View>
  );
}

// ───────────────────────────────────────────────────────────── Overview ──

/** The "This month" card: the month pill and the household budget. */
function BudgetCard({ data }: { data: HouseholdData }) {
  const theme = useTheme();
  const { t } = useStrings();
  const h = t.hhome;
  const limit = data.limit;
  return (
    <Card style={{ gap: theme.spacing.md, padding: theme.spacing.lg }}>
      <CardTitle title={h.thisMonth}>{data.monthPill}</CardTitle>
      {limit !== null && limit > 0n ? (
        <BudgetSummary
          progress={{
            spent: data.spent,
            limit,
            ratio: Number((data.spent * 10000n) / limit) / 10000,
          }}
          perDay={data.perDay}
          hidden={data.hidden}
          fmt={(minor) => data.fmt(minor)}
          t={t}
          onPress={() => router.push(`/group/${data.groupId}/budget`)}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.household.noBudget}
          onPress={() => router.push(`/group/${data.groupId}/budget`)}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text tone="brand" style={{ fontWeight: '700' }}>
            {t.household.noBudget}
          </Text>
          <Text variant="caption" tone="muted">
            {t.household.budgetHint}
          </Text>
        </Pressable>
      )}
    </Card>
  );
}

export function OverviewTab({ data }: { data: HouseholdData }) {
  const theme = useTheme();
  const { t } = useStrings();
  const h = t.hhome;
  return (
    <View style={{ gap: theme.spacing[gap] }}>
      <BudgetCard data={data} />

      <Card style={{ gap: theme.spacing.sm, padding: theme.spacing.lg }}>
        <CardTitle
          title={h.upcomingTitle}
          action={t.homeToday.seeAll}
          onAction={() => data.onTab('upcoming')}
        />
        <UpcomingCardRows rows={data.upcoming.slice(0, 3)} data={data} />
      </Card>

      <Card style={{ gap: theme.spacing.sm, padding: theme.spacing.lg }}>
        <CardTitle
          title={h.recentTitle}
          action={t.personal.dash.viewAll}
          onAction={() => data.onLedger()}
        />
        {data.recent.length === 0 ? (
          <Text variant="caption" tone="muted">
            {h.noExpenses}
          </Text>
        ) : (
          data.recent.map((row, i) => (
            <RecentRow key={row.id} row={row} data={data} last={i === data.recent.length - 1} />
          ))
        )}
      </Card>

      <PrivacyPill
        label={h.sharedNote}
        onPress={() => router.push(`/group/${data.groupId}/settings`)}
      />
    </View>
  );
}

export function RecentRow({
  row,
  data,
  last,
}: {
  row: ExpenseRow;
  data: HouseholdData;
  last: boolean;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const v = row.currentVersion;
  if (!v) return null;
  const date = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${v.expense_date}T00:00:00Z`));
  const title = expenseTitle(v.description, v.category, t);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${date}, ${data.fmt(BigInt(v.amount))}`}
      onPress={() => router.push(`/group/${data.groupId}/expense/${row.id}`)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.sm,
        minHeight: 52,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: theme.color.border,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <CategoryBadge category={v.category} size={40} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text numberOfLines={1} style={{ fontWeight: '600' }}>
          {title}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {date}
        </Text>
      </View>
      <Text numberOfLines={1} style={{ fontWeight: '700', color: theme.color.negative }}>
        {data.hidden ? data.fmt(BigInt(v.amount)) : `−${data.fmt(BigInt(v.amount))}`}
      </Text>
    </Pressable>
  );
}

// ──────────────────────────────────────────────────────────────── Bills ──

export function BillsTab({ data }: { data: HouseholdData }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const h = t.hhome;
  const { confirm } = useDialog();
  const update = useUpdateGroupRecurring(data.groupId);
  const [menuRule, setMenuRule] = useState<GroupRecurringRule | null>(null);
  const [error, setError] = useState<string | null>(null);

  const live = data.rules.filter((rule) => recurringDisplayStatus(rule) !== 'ended');
  const label = (category: string | null): string => {
    const resolved = resolveCategory(category ?? 'other', null);
    return resolved.custom ? (category ?? '') : t.categories[resolved.builtinId ?? 'other'];
  };
  const groups = new Map<string, GroupRecurringRule[]>();
  for (const rule of live) {
    const key = rule.category ?? 'other';
    groups.set(key, [...(groups.get(key) ?? []), rule]);
  }

  const patch = async (
    ruleId: string,
    body: Parameters<typeof update.mutateAsync>[0]['patch'],
  ): Promise<void> => {
    setError(null);
    try {
      await update.mutateAsync({ ruleId, patch: body });
    } catch (caught) {
      setError(friendlyError(caught, t.groupRecurring.couldNotSave, 'household.bill.update'));
    }
  };

  const items: OverflowMenuItem[] = menuRule
    ? [
        {
          icon: 'create-outline',
          label: t.groupRecurring.edit,
          route: `/group/${data.groupId}/recurring-edit?ruleId=${menuRule.id}`,
        },
        {
          icon: recurringDisplayStatus(menuRule) === 'paused' ? 'play-outline' : 'pause-outline',
          label:
            recurringDisplayStatus(menuRule) === 'paused'
              ? t.groupRecurring.resume
              : t.groupRecurring.pause,
          onPress: () =>
            void patch(menuRule.id, {
              status: recurringDisplayStatus(menuRule) === 'paused' ? 'active' : 'paused',
            }),
        },
        {
          icon: 'trash-outline',
          label: t.common.delete,
          tone: 'danger',
          section: 'danger',
          onPress: () => {
            const rule = menuRule;
            void (async () => {
              const ok = await confirm({
                title: fill(t.groupRecurring.stopTitle, { name: rule.description }),
                body: t.groupRecurring.stopBody,
                confirmLabel: t.common.delete,
                tone: 'danger',
              });
              if (ok) await patch(rule.id, { status: 'stopped' });
            })();
          },
        },
      ]
    : [];

  return (
    <View style={{ gap: theme.spacing[gap] }}>
      <Card style={{ gap: theme.spacing.xs, padding: theme.spacing.lg }}>
        <Text
          style={{ fontSize: 20, lineHeight: 26, fontWeight: '800' }}
          accessibilityRole="header"
        >
          {fill(h.billsTotal, { amount: data.fmt(billsMonthlyTotal(live, data.currency)) })}
        </Text>
        {error ? (
          <Text variant="caption" tone="negative">
            {error}
          </Text>
        ) : null}
      </Card>

      {live.length === 0 ? (
        <Card style={{ gap: theme.spacing.xs, padding: theme.spacing.lg }}>
          <Text style={{ fontWeight: '700' }}>{h.billsEmpty}</Text>
          <Text variant="caption" tone="muted">
            {h.billsEmptyHint}
          </Text>
        </Card>
      ) : null}

      {[...groups.entries()].map(([category, rules]) => (
        <Card key={category} style={{ gap: theme.spacing.xs, padding: theme.spacing.lg }}>
          <CardTitle title={label(category)}>
            <Text variant="caption" tone="muted">
              {data.fmt(billsMonthlyTotal(rules, data.currency))}
            </Text>
          </CardTitle>
          {rules.map((rule, i) => {
            const paused = recurringDisplayStatus(rule) === 'paused';
            const day = new Intl.DateTimeFormat(locale, {
              day: 'numeric',
              month: 'short',
              timeZone: 'UTC',
            }).format(new Date(`${rule.nextDate}T00:00:00Z`));
            const monthly = rule.cadence === 'monthly' && rule.interval === 1;
            const when = monthly
              ? fill(h.dayEvery, { day: Number(rule.anchorDate.slice(8, 10)) })
              : day;
            const sub = fill(t.household.billPays, {
              name: data.nameOf(billPayer(rule.payers)),
              when,
            });
            return (
              <View
                key={rule.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.md,
                  minHeight: 56,
                  borderTopWidth: i > 0 ? 1 : 0,
                  borderTopColor: theme.color.border,
                  opacity: paused ? 0.55 : 1,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${rule.description}, ${sub}, ${data.fmt(rule.amount)}${paused ? `, ${t.groupRecurring.paused}` : ''}`}
                  onPress={() =>
                    router.push(`/group/${data.groupId}/recurring-edit?ruleId=${rule.id}`)
                  }
                  style={{
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.md,
                  }}
                >
                  <CategoryBadge category={rule.category} size={36} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontWeight: '700' }}>
                      {rule.description}
                    </Text>
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      {paused ? t.groupRecurring.paused : sub}
                    </Text>
                  </View>
                  <Text numberOfLines={1} style={{ fontWeight: '700' }}>
                    {data.fmt(rule.amount)}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={fill(h.billOptions, { name: rule.description })}
                  onPress={() => setMenuRule(rule)}
                  hitSlop={8}
                  style={{ width: 36, height: 44, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Ionicons
                    name="ellipsis-vertical"
                    size={iconSize.md}
                    color={theme.color.textMuted}
                  />
                </Pressable>
              </View>
            );
          })}
        </Card>
      ))}

      <Card style={{ paddingVertical: theme.spacing.xs, paddingHorizontal: theme.spacing.lg }}>
        <AddRow
          label={h.addBillRow}
          onPress={() => router.push(`/group/${data.groupId}/add-bills`)}
        />
      </Card>
      <OverflowMenu visible={menuRule !== null} onClose={() => setMenuRule(null)} items={items} />
    </View>
  );
}

// ───────────────────────────────────────────────────────────── Upcoming ──

export function UpcomingTab({ data }: { data: HouseholdData }) {
  const theme = useTheme();
  const { t } = useStrings();
  return (
    <Card style={{ gap: theme.spacing.sm, padding: theme.spacing.lg }}>
      <CardTitle title={t.hhome.upcomingTitle} />
      <UpcomingList rows={data.upcoming} data={data} />
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────── Income ──

export function IncomeTab({ data }: { data: HouseholdData }) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const h = t.hhome;
  const kindLabel = {
    salary: h.kindSalary,
    pension: h.kindPension,
    business: h.kindBusiness,
    rent: h.kindRent,
    other: h.kindOther,
  } as const;
  return (
    <View style={{ gap: theme.spacing[gap] }}>
      <Card style={{ gap: theme.spacing.xs, padding: theme.spacing.lg }}>
        <Text
          style={{ fontSize: 20, lineHeight: 26, fontWeight: '800' }}
          accessibilityRole="header"
        >
          {fill(h.incomeTotal, { amount: data.fmt(data.income) })}
        </Text>
        <Text variant="caption" tone="muted">
          {h.incomeNote}
        </Text>
      </Card>

      {data.plans.length === 0 ? (
        <Card style={{ gap: theme.spacing.xs, padding: theme.spacing.lg }}>
          <Text style={{ fontWeight: '700' }}>{h.incomeEmpty}</Text>
          <Text variant="caption" tone="muted">
            {h.incomeEmptyHint}
          </Text>
        </Card>
      ) : (
        <Card style={{ padding: theme.spacing.lg }}>
          {data.plans.map((plan, i) => {
            const name = data.nameOf(plan.memberId);
            const sub = `${plan.label.trim() || kindLabel[plan.kind]} · ${new Intl.NumberFormat(locale).format(plan.dayOfMonth)}`;
            return (
              <Pressable
                key={plan.id}
                accessibilityRole="button"
                accessibilityLabel={`${name}, ${sub}, ${data.fmt(plan.amount)}`}
                onPress={() => router.push(`/group/${data.groupId}/income-edit?plan=${plan.id}`)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.md,
                  minHeight: 56,
                  borderTopWidth: i > 0 ? 1 : 0,
                  borderTopColor: theme.color.border,
                  opacity: pressed ? 0.6 : plan.active ? 1 : 0.5,
                })}
              >
                <PersonAvatar name={name} size={36} ghost={data.isGhostMember(plan.memberId)} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontWeight: '700' }}>
                    {name}
                  </Text>
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    {sub}
                  </Text>
                </View>
                <Text numberOfLines={1} style={{ fontWeight: '700' }}>
                  {data.fmt(plan.amount)}
                </Text>
              </Pressable>
            );
          })}
        </Card>
      )}

      <Card style={{ paddingVertical: theme.spacing.xs, paddingHorizontal: theme.spacing.lg }}>
        <AddRow
          label={h.addIncomeRow}
          onPress={() => router.push(`/group/${data.groupId}/income-edit`)}
        />
      </Card>
      <Card style={{ paddingVertical: theme.spacing.xs, paddingHorizontal: theme.spacing.lg }}>
        <AddFamilyMember groupId={data.groupId} />
      </Card>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────── Planning ──

/** Personal's Planning, for the household: budget, what is due, bills and income plans. */
export function PlanningTab({ data }: { data: HouseholdData }) {
  const theme = useTheme();
  const { t } = useStrings();
  const h = t.hhome;
  const row = (
    icon: keyof typeof Ionicons.glyphMap,
    label: string,
    value: string,
    tab: 'bills' | 'income',
  ) => (
    <Pressable
      key={tab}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      onPress={() => data.onTab(tab)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        minHeight: 52,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={iconSize.md} color={theme.color.brand} />
      <Text style={{ flex: 1, fontWeight: '700' }} numberOfLines={1}>
        {label}
      </Text>
      <Text numberOfLines={1} tone="muted">
        {value}
      </Text>
      <Ionicons
        name={directionalIcon('chevron-forward')}
        size={iconSize.sm}
        color={theme.color.textMuted}
      />
    </Pressable>
  );
  return (
    <View style={{ gap: theme.spacing[gap] }}>
      <BudgetCard data={data} />
      <Card style={{ paddingVertical: theme.spacing.xs, paddingHorizontal: theme.spacing.lg }}>
        {row('repeat', h.tabBills, data.fmt(data.billsMonthly), 'bills')}
        {row('arrow-down-circle-outline', h.tabIncome, data.fmt(data.income), 'income')}
      </Card>
      <UpcomingTab data={data} />
    </View>
  );
}
