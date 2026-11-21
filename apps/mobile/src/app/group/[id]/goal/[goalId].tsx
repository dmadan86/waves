/**
 * One joint goal: a ring (what is put aside of the target), each person's
 * monthly share against this month, the monthly amount that reaches the target
 * by its date, and the history. "Put money aside" is the one action; "Take out"
 * and the rest live in the ⋮ menu. Wording is always "put aside", never "saved",
 * and nothing counts returns.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';

import {
  goalProgressPct,
  memberMonthStatus,
  monthlyNeeded,
  monthsLeft,
  type CurrencyCode,
} from '@waves/core';
import { Button, Callout, EmptyState, iconSize, Row, Screen, Text, useTheme } from '@waves/ui';

import { ContributionSheet } from '@/components/goals/ContributionSheet';
import { GoalRing } from '@/components/goals/GoalRing';
import { goalAmount, goalMonthShort, goalMonthYear } from '@/components/goals/goalText';
import { OverflowMenu, type OverflowMenuItem } from '@/components/OverflowMenu';
import { withScenicGroup } from '@/components/ScenicScope';
import { PlainHeader, StandardCard } from '@/components/standard';
import {
  useAddContribution,
  useArchiveGoal,
  useGroupGoals,
  useVoidContribution,
} from '@/data/groupGoals';
import { useGroup } from '@/data/hooks';
import { todayIso } from '@/data/personal';
import { displayName, type MemberRow } from '@/data/types';
import { fill, plural, useStrings } from '@/i18n';
import { useDialog } from '@/lib/dialog';
import { friendlyError } from '@/lib/errors';
import { showDate } from '@/lib/expenseDay';
import { router } from '@/lib/navigation';

function GoalScreen() {
  const { id, goalId } = useLocalSearchParams<{ id: string; goalId: string }>();
  const groupId = id ?? '';
  const theme = useTheme();
  const { t, locale } = useStrings();
  const g = t.groupGoals;
  const { confirm } = useDialog();
  const { members } = useGroup(groupId);
  const { goals, myMemberId } = useGroupGoals(groupId);
  const add = useAddContribution(groupId);
  const voidLine = useVoidContribution(groupId);
  const archive = useArchiveGoal(groupId);
  const [sheet, setSheet] = useState<'aside' | 'out' | null>(null);
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const view = goals.find((entry) => entry.goal.id === goalId);
  const everyone = (members.data ?? []) as MemberRow[];
  const name = (memberId: string): string => {
    const member = everyone.find((entry) => entry.id === memberId);
    return member ? displayName(member, null, null, t.misc.someone) : t.misc.someone;
  };

  if (!view) {
    return (
      <Screen edges={['bottom']}>
        <PlainHeader title={g.title} />
        <EmptyState title={g.notFound} />
      </Screen>
    );
  }

  const { goal, lines, total } = view;
  const currency = goal.currency as CurrencyCode;
  const today = todayIso();
  const live = everyone.filter((member) => !member.left_at);
  const month = today.slice(0, 7);
  const statuses = memberMonthStatus(goal, lines, month);
  const needed = monthlyNeeded(goal, total, today);
  const left = monthsLeft(goal.targetDate, today);
  const pct = goalProgressPct(goal, total);
  const put = goalAmount(total, currency, locale);
  const target = goalAmount(goal.targetMinor, currency, locale);
  const subtitle = [
    goal.targetDate ? fill(g.by, { date: goalMonthYear(goal.targetDate, locale) }) : g.noDate,
    goal.forMemberId ? fill(g.forWho, { name: name(goal.forMemberId) }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const fail = (caught: unknown): void =>
    setError(friendlyError(caught, g.couldNotSave, 'groupGoal.write'));

  const removeLine = async (lineId: string, amountMinor: bigint): Promise<void> => {
    setError(null);
    // A later withdrawal would be left without the money it took out.
    if (total - amountMinor < 0n) {
      setError(g.removeRefused);
      return;
    }
    const ok = await confirm({
      title: g.removeTitle,
      body: g.removeBody,
      confirmLabel: g.removeEntry,
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await voidLine.mutateAsync(lineId);
    } catch (caught) {
      fail(caught);
    }
  };

  const setStatus = (status: 'active' | 'done' | 'archived'): void => {
    archive.mutate({ goalId: goal.id, status });
    if (status === 'archived') router.back();
  };

  const items: OverflowMenuItem[] = [
    {
      icon: 'create-outline',
      label: g.edit,
      route: `/group/${groupId}/goal-edit?goal=${goal.id}`,
    },
    { icon: 'arrow-down-circle-outline', label: g.takeOut, onPress: () => setSheet('out') },
    goal.status === 'done'
      ? { icon: 'refresh-outline', label: g.reopen, onPress: () => setStatus('active') }
      : { icon: 'checkmark-circle-outline', label: g.markDone, onPress: () => setStatus('done') },
    {
      icon: 'archive-outline',
      label: g.archive,
      tone: 'danger',
      onPress: () => {
        void confirm({
          title: g.archiveTitle,
          body: g.archiveBody,
          confirmLabel: g.archive,
          tone: 'danger',
        }).then((ok) => ok && setStatus('archived'));
      },
    },
  ];

  return (
    <Screen edges={['bottom']}>
      <PlainHeader
        title={`${goal.emoji ? `${goal.emoji} ` : ''}${goal.name}`}
        subtitle={subtitle}
        trailing={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={g.menu}
            hitSlop={10}
            onPress={() => setMenu(true)}
            style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="ellipsis-vertical" size={iconSize.lg} color={theme.color.text} />
          </Pressable>
        }
      />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.lg,
          gap: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{ alignItems: 'center', paddingVertical: theme.spacing.md }}
          accessible
          accessibilityLabel={fill(g.ringA11y, { name: goal.name, put, target, pct })}
        >
          <GoalRing pct={pct} size={200} stroke={18}>
            <Text
              style={{ fontSize: 30, fontWeight: '800' }}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {put}
            </Text>
            <Text variant="caption" tone="muted">
              {fill(g.ringOf, { target })}
            </Text>
          </GoalRing>
          {left !== null && left > 0 ? (
            <Text variant="caption" tone="muted" style={{ marginTop: theme.spacing.sm }}>
              {plural(locale, left, g.monthsLeft)}
            </Text>
          ) : null}
        </View>

        {statuses.length > 0 ? (
          <StandardCard>
            {statuses.map((status, index) => (
              <Row
                key={status.memberId}
                style={{
                  alignItems: 'center',
                  minHeight: 44,
                  borderTopWidth: index > 0 ? 1 : 0,
                  borderTopColor: theme.color.border,
                }}
              >
                <Text variant="body" style={{ flex: 1 }} numberOfLines={2}>
                  {fill(g.perMonth, {
                    name: name(status.memberId),
                    amount: goalAmount(status.plannedMinor, currency, locale),
                  })}
                </Text>
                {status.met ? (
                  <Row style={{ alignItems: 'center', gap: 4 }}>
                    <Ionicons name="checkmark" size={iconSize.md} color={theme.color.positive} />
                    <Text tone="positive" style={{ fontWeight: '700' }}>
                      {fill(g.monthMet, { month: goalMonthShort(month, locale) })}
                    </Text>
                  </Row>
                ) : (
                  <Text tone="negative" style={{ fontWeight: '700' }}>
                    {fill(g.short, { amount: goalAmount(status.shortMinor, currency, locale) })}
                  </Text>
                )}
              </Row>
            ))}
          </StandardCard>
        ) : null}

        <View style={{ gap: 2 }}>
          {total >= goal.targetMinor ? (
            <Text variant="body" tone="muted">
              {g.reached}
            </Text>
          ) : needed !== null ? (
            <Text variant="body" tone="muted">
              {fill(g.needNudge, { amount: goalAmount(needed, currency, locale) })}
            </Text>
          ) : null}
          <Text variant="body" tone="muted">
            {g.noReturns}
          </Text>
        </View>

        {error ? <Callout tone="negative">{error}</Callout> : null}

        <Text variant="subheading" accessibilityRole="header">
          {g.history}
        </Text>
        {lines.length === 0 ? (
          <Text variant="caption" tone="muted">
            {g.historyEmpty}
          </Text>
        ) : (
          <StandardCard>
            {lines.map((line, index) => {
              const out = line.amountMinor < 0n;
              const abs = goalAmount(out ? -line.amountMinor : line.amountMinor, currency, locale);
              const words = fill(out ? g.entryOut : g.entryAside, {
                name: name(line.memberId),
                amount: abs,
              });
              return (
                <Row
                  key={line.id}
                  style={{
                    alignItems: 'center',
                    minHeight: 48,
                    gap: theme.spacing.sm,
                    borderTopWidth: index > 0 ? 1 : 0,
                    borderTopColor: theme.color.border,
                    opacity: line.pending ? 0.6 : 1,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text variant="body" numberOfLines={2}>
                      {words}
                    </Text>
                    <Text variant="micro" tone="muted">
                      {showDate(line.date, locale)}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${g.removeEntry}: ${words}`}
                    hitSlop={8}
                    onPress={() => void removeLine(line.id, line.amountMinor)}
                    style={{
                      minWidth: 44,
                      minHeight: 44,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="close" size={iconSize.md} color={theme.color.textMuted} />
                  </Pressable>
                </Row>
              );
            })}
          </StandardCard>
        )}
      </ScrollView>

      <View style={{ paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.md }}>
        <Button label={g.putAside} onPress={() => setSheet('aside')} />
      </View>

      {sheet ? (
        <ContributionSheet
          key={sheet}
          visible
          mode={sheet}
          currency={currency}
          members={live}
          defaultMemberId={myMemberId}
          total={total}
          busy={add.isPending}
          onClose={() => setSheet(null)}
          onSave={(input) => {
            setError(null);
            add
              .mutateAsync({ goalId: goal.id, ...input })
              .then(() => setSheet(null))
              .catch(fail);
          }}
        />
      ) : null}
      <OverflowMenu visible={menu} onClose={() => setMenu(false)} items={items} />
    </Screen>
  );
}

export default withScenicGroup(GoalScreen);
