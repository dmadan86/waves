/**
 * The five tabs of the household home. Each takes the one `HouseholdData` the
 * screen builds, so they stay plain views: Overview, Bills, Upcoming, Income
 * and Goals. Amounts honour the eye (`data.fmt` masks when hidden).
 */
import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import {
  billsMonthlyTotal,
  perDayLeft,
  recurringDisplayStatus,
  resolveCategory,
  type GroupRecurringRule,
  type HouseholdUpcoming,
} from '@waves/core';
import { Card, iconSize, Row, Text, useTheme } from '@waves/ui';

import { CategoryBadge } from '@/components/Category';
import { GroupGoalsCard } from '@/components/GroupGoalsCard';
import { AddFamilyMember } from '@/components/household/HouseholdParts';
import { BudgetSummary } from '@/components/home/MonthParts';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { PersonAvatar } from '@/components/PersonAvatar';
import { CardTitle, MoneyToolsRow, PrivacyPill } from '@/components/personal/PersonalHomeParts';
import { useUpdateGroupRecurring } from '@/data/groupRecurring';
import type { GroupGoalView } from '@/data/groupGoals';
import type { IncomePlan } from '@/data/groupIncome';
import { expenseTitle } from '@/data/expenseTitle';
import { todayIso } from '@/data/personal';
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
  readonly goals: readonly GroupGoalView[];
  readonly upcoming: readonly HouseholdUpcoming[];
  readonly spent: bigint;
  readonly income: bigint;
  /** The monthly ceiling: the household budget, else the planned income. */
  readonly limit: bigint | null;
  readonly recent: readonly ExpenseRow[];
  readonly onAddGoal: () => void;
  /** Post one bill occurrence as a group expense; the row goes once it is paid. */
  readonly onMarkPaid: (row: HouseholdUpcoming) => Promise<void>;
  readonly onTab: (tab: 'bills' | 'income' | 'goals' | 'upcoming') => void;
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
  const tone = row.inDays < 0 ? 'negative' : row.kind === 'goal' ? 'positive' : 'brand';
  const ink = theme.color[tone];
  const soft = theme.color[`${tone}Soft` as 'brandSoft'];
  const day = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${row.date}T00:00:00Z`));
  const subtitle =
    row.kind === 'goal'
      ? `${t.hhome.tabGoals} · ${day}`
      : row.payerId
        ? fill(t.household.billPays, { name: data.nameOf(row.payerId), when: day })
        : day;
  const pill = whenText(row.inDays);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.title}, ${subtitle}, ${data.fmt(row.amount)}, ${pill}`}
      onPress={() =>
        router.push(
          row.kind === 'goal'
            ? `/group/${data.groupId}/goal/${row.goalId}`
            : `/group/${data.groupId}/recurring-edit?ruleId=${row.ruleId}`,
        )
      }
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
        <Ionicons
          name={row.kind === 'goal' ? 'flag-outline' : 'receipt-outline'}
          size={iconSize.md}
          color={ink}
        />
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

// ───────────────────────────────────────────────────────────── Overview ──

export function OverviewTab({ data }: { data: HouseholdData }) {
  const theme = useTheme();
  const { t } = useStrings();
  const h = t.hhome;
  const today = todayIso();
  const limit = data.limit;
  return (
    <View style={{ gap: theme.spacing[gap] }}>
      <Card style={{ gap: theme.spacing.md, padding: theme.spacing.lg }}>
        <CardTitle title={h.thisMonth} />
        {limit !== null && limit > 0n ? (
          <BudgetSummary
            progress={{
              spent: data.spent,
              limit,
              ratio: Number((data.spent * 10000n) / limit) / 10000,
            }}
            perDay={perDayLeft(limit - data.spent, today)}
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

      <Card style={{ gap: theme.spacing.sm, padding: theme.spacing.lg }}>
        <CardTitle
          title={h.upcomingTitle}
          action={t.personal.dash.viewAll}
          onAction={() => data.onTab('upcoming')}
        />
        <UpcomingList rows={data.upcoming.slice(0, 3)} data={data} />
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

      <Card style={{ gap: theme.spacing.sm, padding: theme.spacing.lg }}>
        <CardTitle title={t.personal.dash.moneyTools} />
        <MoneyToolsRow
          tiles={[
            {
              key: 'bills',
              tint: 'lilac',
              icon: 'repeat',
              label: h.tabBills,
              onPress: () => data.onTab('bills'),
            },
            {
              key: 'income',
              tint: 'mint',
              icon: 'arrow-down',
              label: h.tabIncome,
              onPress: () => data.onTab('income'),
            },
            {
              key: 'goals',
              tint: 'sky',
              icon: 'flag-outline',
              label: h.tabGoals,
              onPress: () => data.onTab('goals'),
            },
            {
              key: 'expenses',
              tint: 'peach',
              icon: 'receipt-outline',
              label: t.expenses,
              onPress: () => data.onLedger(),
            },
            {
              key: 'more',
              tint: 'lilac',
              icon: 'ellipsis-horizontal',
              label: t.personalHome.toolMore,
              onPress: data.onMore,
            },
          ]}
        />
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
        minHeight: 52,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: theme.color.border,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <CategoryBadge category={v.category} size={36} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontWeight: '700' }}>
          {title}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {date}
        </Text>
      </View>
      <Text numberOfLines={1} style={{ fontWeight: '700' }}>
        {data.fmt(BigInt(v.amount))}
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

// ───────────────────────────────────────────────────────────────── Goals ──

export function GoalsTab({ data }: { data: HouseholdData }) {
  return <GroupGoalsCard groupId={data.groupId} />;
}
