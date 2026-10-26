import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Network from 'expo-network';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { format, money, resolveCategory, type CurrencyCode } from '@waves/core';
import {
  Button,
  directionalIcon,
  EmptyState,
  Chip,
  iconSize,
  Row,
  Screen,
  Text,
  useTheme,
} from '@waves/ui';
import { useGroup, useGroupLedger, useResplitDeparted } from '@/data/hooks';
import { CategoryBadge, builtinCategoryLabel } from '@/components/Category';
import { BalanceSide } from '@/components/home/BalanceSide';
import { PersonAvatar } from '@/components/PersonAvatar';
import {
  PairHero,
  HeroCircleButton,
  HERO_OVERLAP,
  HERO_TEXT_SHADOW,
  Chevron,
} from '@/components/person/pairParts';
import { expenseTitle } from '@/data/expenseTitle';
import { displayName } from '@/data/types';
import { fill, plural, useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { useBottomClearance } from '@/lib/clearance';
import {
  buildResplitItem,
  departedCategoryCounts,
  departedExpenseTotals,
  departedPairSummary,
  selectedDepartedCandidates,
  sortDepartedExpenses,
  type DepartedSort,
  classifyDepartedExpenses,
  summarizeDepartedExpenses,
  type Expense,
} from '@/lib/departedExpenses';
import { useDialog } from '@/lib/dialog';
import { friendlyError } from '@/lib/errors';
import { settleHref } from '@/lib/groupTab';
import { router, useGoBack } from '@/lib/navigation';
import { SyncStatus, useSync } from '@/sync';

export default function DepartedExpensesScreen() {
  const { id = '', memberId = '' } = useLocalSearchParams<{ id: string; memberId: string }>();
  const theme = useTheme();
  const goBack = useGoBack(`/group/${id}`);
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const s = t.departedExpenses;
  const viewerId = useViewerId();
  const { group, members, everyone, expenses } = useGroup(id);
  const ledger = useGroupLedger(id, viewerId);
  const mutation = useResplitDeparted(id);
  const { status } = useSync();
  const network = Network.useNetworkState();
  const { confirm } = useDialog();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<DepartedSort>('newest');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const member = everyone.data?.find((m) => m.id === memberId);
  const admin = members.data?.some(
    (m) => m.id === ledger.myMemberId && m.role === 'admin' && !m.left_at,
  );
  const { equal, custom, paid } = classifyDepartedExpenses(
    expenses.rows,
    memberId,
    ledger.myMemberId ?? undefined,
  );
  const candidates = [...equal, ...custom];
  const byId = new Map(candidates.map((candidate) => [candidate.expense.id, candidate]));
  const selectable = candidates.filter((candidate) => !candidate.noneRemaining);
  const selected = selectedDepartedCandidates(candidates, selectedIds);
  const listed = [...candidates.map((candidate) => candidate.expense), ...paid];
  const categories = departedCategoryCounts(listed);
  const summary = departedPairSummary(listed, memberId, ledger.myMemberId ?? '', group.data);
  const visible = sortDepartedExpenses(
    listed.filter(
      (expense) => category === null || (expense.currentVersion!.category ?? 'other') === category,
    ),
    sort,
  );
  const sections = new Map<string, Expense[]>();
  for (const expense of visible) {
    const date = expense.currentVersion!.expense_date;
    const rows = sections.get(date);
    if (rows) rows.push(expense);
    else sections.set(date, [expense]);
  }
  const allSelected = selectable.length > 0 && selected.length === selectable.length;
  const toggleAll = () => {
    if (mutation.isPending) return;
    setSelectedIds(
      allSelected ? new Set() : new Set(selectable.map((candidate) => candidate.expense.id)),
    );
  };
  const toggleExpense = (expenseId: string) => {
    if (mutation.isPending) return;
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(expenseId)) next.delete(expenseId);
      else next.add(expenseId);
      return next;
    });
  };
  const items = selected.flatMap((c) => buildResplitItem(c, memberId) ?? []);
  const fmt = (amount: bigint, currency = group.data?.default_currency ?? 'INR') =>
    format(money(amount, currency as CurrencyCode), { locale });
  const totals = (rows: Expense[]) => summarizeDepartedExpenses(rows, memberId, group.data).totals;
  const showTotals = (values: Map<string, bigint>) =>
    [...values].map(([currency, amount]) => fmt(amount, currency)).join(' · ') || fmt(0n);
  const moved = totals(selected.map((c) => c.expense));
  const recipients = new Set(selected.flatMap((c) => c.remainingParticipants));
  const onlyViewer = recipients.size === 1 && recipients.has(ledger.myMemberId ?? '');
  const count = items.length;
  const offline =
    status === SyncStatus.Offline ||
    network.isConnected === false ||
    network.isInternetReachable === false;
  const allowed = !!admin && !!member?.left_at && !offline && !mutation.isPending && count > 0;
  const name = member ? displayName(member, null, undefined, t.misc.someone) : '';
  const label = fill(s.title, { name });
  const submit = async () => {
    if (!allowed) return;
    const balance = new Map(
      [...ledger.net].map(([currency, balances]) => [
        currency,
        (balances.get(memberId) ?? 0n) + (moved.get(currency) ?? 0n),
      ]),
    );
    const body = fill(onlyViewer ? s.onlyViewerDialog : s.dialog, {
      name,
      amount: showTotals(moved),
      n: recipients.size,
      perEach: showTotals(
        new Map(
          [...moved].map(([currency, amount]) => [currency, amount / BigInt(recipients.size || 1)]),
        ),
      ),
      balance: showTotals(balance),
    });
    if (!(await confirm({ title: label, body, confirmLabel: plural(locale, count, s.confirm) })))
      return;
    const connection = await Network.getNetworkStateAsync().catch(() => null);
    if (!connection || connection.isConnected === false || connection.isInternetReachable === false)
      return;
    mutation.mutate({ memberId, items }, { onSuccess: () => router.back() });
  };
  const checkbox = (
    checked: boolean,
    onPress: () => void,
    label: string,
    disabled = false,
    mixed = false,
  ) => (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: mixed ? 'mixed' : checked, disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={{
        width: 36,
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Ionicons
        name={mixed ? 'remove-circle-outline' : checked ? 'checkbox' : 'square-outline'}
        size={24}
        color={checked || mixed ? theme.color.brand : theme.color.textMuted}
      />
    </Pressable>
  );
  const expenseCount = (n: number) => plural(locale, n, s.expenseCount);
  const sortLabels = { newest: s.dateNewest, oldest: s.dateOldest, amount: s.amountSort };
  const amountLine = (values: Map<string, bigint>) =>
    [...values]
      .map(([currency, amount]) =>
        fill(
          amount < 0n
            ? plural(locale, listed.length, s.isOwed)
            : plural(locale, listed.length, s.owed),
          {
            name,
            amount: fmt(amount < 0n ? -amount : amount, currency),
          },
        ),
      )
      .join(' · ');
  if (!member || !admin || !member.left_at)
    return (
      <Screen>
        <EmptyState title={t.people.memberNotFound} body={t.people.memberNotFoundBody} />
      </Screen>
    );
  return (
    <Screen edges={[]}>
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: theme.spacing.lg }}
      >
        <PairHero>
          <HeroCircleButton
            icon={directionalIcon('chevron-back')}
            label={t.common.back}
            onPress={goBack}
          />
          <Row
            style={{
              alignItems: 'center',
              gap: theme.spacing.md,
              paddingVertical: theme.spacing.sm,
            }}
          >
            <PersonAvatar name={name} size={52} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="title" style={{ color: '#FFFFFF', ...HERO_TEXT_SHADOW }}>
                {label}
              </Text>
              <Text variant="caption" style={{ color: '#FFFFFF', ...HERO_TEXT_SHADOW }}>
                {amountLine(summary.net) ||
                  fill(plural(locale, listed.length, s.owed), { name, amount: fmt(0n) })}
              </Text>
            </View>
          </Row>
        </PairHero>
        <View
          style={{
            marginTop: -HERO_OVERLAP,
            paddingHorizontal: theme.spacing.md,
            gap: theme.spacing.md,
          }}
        >
          <Row
            style={{
              backgroundColor: theme.color.surface,
              borderRadius: theme.radius.xl,
              padding: theme.spacing.md,
              ...theme.shadow.soft,
            }}
          >
            {(
              [
                ['lent', summary.lent],
                ['owe', summary.owe],
              ] as const
            ).map(([direction, side], index) => {
              const [head, ...rest] = [...side.totals];
              return (
                <View key={direction} style={{ flex: 1, flexDirection: 'row' }}>
                  {index === 1 && (
                    <View style={{ width: 1, backgroundColor: theme.color.border }} />
                  )}
                  <BalanceSide
                    icon={direction === 'lent' ? 'arrow-up' : 'arrow-down'}
                    color={direction === 'lent' ? theme.color.positive : theme.color.negative}
                    amount={head?.[1] ?? 0n}
                    amountColor={direction === 'lent' ? theme.color.positive : theme.color.text}
                    currency={head?.[0] ?? group.data?.default_currency ?? 'INR'}
                    label={fill(direction === 'lent' ? s.youLent : s.youOwe, { name })}
                    detail={expenseCount(side.count)}
                    locale={locale}
                    hidden={false}
                    loading={false}
                    trailing={index === 1}
                    chips={rest.map(([currency, amount]) => ({ currency, amount }))}
                  />
                </View>
              );
            })}
          </Row>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: theme.spacing.sm }}
          >
            <Chip
              label={`${s.all} (${listed.length})`}
              selected={category === null}
              onPress={() => setCategory(null)}
              variant="brand"
              repeatable
            />
            {[...categories].map(([key, n]) => (
              <Chip
                key={key}
                label={`${builtinCategoryLabel(t, resolveCategory(key))} (${n})`}
                selected={category === key}
                onPress={() => setCategory(key)}
                variant="brand"
                repeatable
              />
            ))}
          </ScrollView>
          <Row
            style={{
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: theme.color.surface,
              borderRadius: theme.radius.md,
              paddingHorizontal: theme.spacing.sm,
            }}
          >
            <Row style={{ alignItems: 'center', flexShrink: 1 }}>
              {checkbox(
                allSelected,
                toggleAll,
                fill(s.selectAll, { n: selectable.length }),
                mutation.isPending || selectable.length === 0,
                selected.length > 0 && !allSelected,
              )}
              <Text variant="caption">{fill(s.selectAll, { n: selectable.length })}</Text>
            </Row>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={sortLabels[sort]}
              onPress={() =>
                setSort(sort === 'newest' ? 'oldest' : sort === 'oldest' ? 'amount' : 'newest')
              }
              style={{
                minHeight: 44,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: theme.spacing.sm,
              }}
            >
              <Ionicons name="options-outline" size={iconSize.sm} color={theme.color.text} />
              <Text variant="caption">{sortLabels[sort]}</Text>
            </Pressable>
          </Row>
          {[...sections].map(([date, rows]) => (
            <View
              key={date}
              style={{
                borderRadius: theme.radius.lg,
                backgroundColor: theme.color.surfaceMuted,
                overflow: 'hidden',
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: !collapsed.has(date) }}
                onPress={() =>
                  setCollapsed((previous) => {
                    const next = new Set(previous);
                    if (next.has(date)) next.delete(date);
                    else next.add(date);
                    return next;
                  })
                }
                style={{
                  minHeight: 40,
                  paddingHorizontal: theme.spacing.md,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.sm,
                }}
              >
                <Text variant="caption" style={{ flex: 1 }}>
                  {new Date(`${date}T12:00:00`).toLocaleDateString(locale, {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </Text>
                <Text variant="micro" tone="muted">
                  {expenseCount(rows.length)} ·{' '}
                  {showTotals(departedExpenseTotals(rows, group.data))}
                </Text>
                <Ionicons
                  name={collapsed.has(date) ? 'chevron-down' : 'chevron-up'}
                  size={iconSize.sm}
                  color={theme.color.textMuted}
                />
              </Pressable>
              {!collapsed.has(date) && (
                <View
                  style={{ backgroundColor: theme.color.surface, borderRadius: theme.radius.lg }}
                >
                  {rows.map((expense, index) => {
                    const version = expense.currentVersion!;
                    const candidate = byId.get(expense.id);
                    const isPaid = !candidate;
                    const share =
                      candidate?.memberShare ??
                      BigInt(
                        version.shares.find((entry) => entry.member_id === memberId)?.amount ?? '0',
                      );
                    const title = expenseTitle(version.description, version.category, t);
                    return (
                      <Row
                        key={expense.id}
                        style={{
                          alignItems: 'center',
                          paddingHorizontal: theme.spacing.sm,
                          borderTopWidth: index ? 1 : 0,
                          borderColor: theme.color.border,
                        }}
                      >
                        {!isPaid ? (
                          checkbox(
                            selectedIds.has(expense.id) && !candidate.noneRemaining,
                            () => toggleExpense(expense.id),
                            title,
                            mutation.isPending || candidate.noneRemaining,
                          )
                        ) : (
                          <View style={{ width: 36 }} />
                        )}
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => router.push(`/group/${id}/expense/${expense.id}`)}
                          style={{
                            flex: 1,
                            minHeight: 68,
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: theme.spacing.sm,
                            paddingVertical: theme.spacing.sm,
                          }}
                        >
                          <CategoryBadge
                            category={version.category}
                            description={version.description}
                            size={36}
                          />
                          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                            <Text variant="subheading" numberOfLines={1}>
                              {title}
                            </Text>
                            <Text variant="micro" tone="muted" numberOfLines={2}>
                              {fill(version.split_type === 'equal' ? s.equalShare : s.customShare, {
                                amount: fmt(share, version.currency),
                              })}
                            </Text>
                            {isPaid && (
                              <Text
                                variant="micro"
                                style={{
                                  color: theme.color.brand,
                                  backgroundColor: theme.color.brandSoft,
                                  alignSelf: 'flex-start',
                                  borderRadius: theme.radius.sm,
                                  paddingHorizontal: theme.spacing.xs,
                                }}
                              >
                                {fill(s.paidBy, { name })}
                              </Text>
                            )}
                          </View>
                          <Text variant="subheading" style={{ color: theme.color.brand }}>
                            {fmt(BigInt(version.amount), version.currency)}
                          </Text>
                          <Chevron />
                        </Pressable>
                      </Row>
                    );
                  })}
                </View>
              )}
            </View>
          ))}
          {visible.length === 0 && <Text tone="muted">{t.activityScreen.noneForFilter}</Text>}
          {mutation.isError && (
            <Text tone="negative">
              {friendlyError(mutation.error, t.couldNotSave, 'departed.resplit')}
            </Text>
          )}
        </View>
      </ScrollView>
      <View
        style={{
          paddingHorizontal: theme.spacing.md,
          paddingTop: theme.spacing.sm,
          paddingBottom: clearance,
          backgroundColor: theme.color.surface,
          borderTopLeftRadius: theme.radius.xl,
          borderTopRightRadius: theme.radius.xl,
          gap: theme.spacing.xs,
          ...theme.shadow.soft,
        }}
      >
        {offline && (
          <Text variant="caption" tone="muted">
            {s.offline}
          </Text>
        )}
        <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
          {checkbox(
            allSelected,
            toggleAll,
            fill(s.selectAll, { n: selectable.length }),
            mutation.isPending || selectable.length === 0,
            selected.length > 0 && !allSelected,
          )}
          <Text variant="caption" style={{ flex: 1 }}>
            {fill(s.selectedShares, { n: count, amount: showTotals(moved) })}
          </Text>
          {mutation.isPending && <ActivityIndicator color={theme.color.brand} />}
        </Row>
        <Row style={{ gap: theme.spacing.sm }}>
          <Button
            size="sm"
            variant="secondary"
            label={s.splitOthers}
            disabled={!allowed}
            onPress={() => void submit()}
            style={{
              flex: 1,
              paddingHorizontal: theme.spacing.sm,
              backgroundColor: theme.color.surface,
              borderWidth: 1,
              borderColor: theme.color.brand,
            }}
          />
          <Button
            size="sm"
            variant="brand"
            label={fill(s.settle, { name })}
            disabled={mutation.isPending}
            onPress={() => router.push(settleHref(id))}
            style={{ flex: 1, paddingHorizontal: theme.spacing.sm }}
          />
        </Row>
      </View>
    </Screen>
  );
}
