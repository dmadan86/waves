/**
 * The group home's goals: one compact row per goal (small ring, name, "₹3.2 lakh
 * of ₹15 lakh", a pace pill) and "Add a goal". Works in any group, split or
 * pooled. Free groups have up to two active goals; a third opens the Pro plans.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { goalPace, goalProgressPct, type CurrencyCode } from '@waves/core';
import { iconSize, Row, Text, useTheme } from '@waves/ui';

import { GoalRing } from '@/components/goals/GoalRing';
import { goalAmount, paceLabel } from '@/components/goals/goalText';
import { StandardCard } from '@/components/standard';
import { useGroupGoals, type GroupGoalView } from '@/data/groupGoals';
import { todayIso } from '@/data/personal';
import { useStrings } from '@/i18n';
import { useEntitlement } from '@/lib/useEntitlement';
import { router } from '@/lib/navigation';
import { useToast } from '@/lib/toast';

/** Free groups: this many active goals before the Pro plans open. */
export const FREE_GOAL_LIMIT = 2;

/** Open the new-goal screen, or the plans when a free group already has its two. */
export function useAddGoal(groupId: string, activeCount: number): () => void {
  const { isPaid, loading } = useEntitlement();
  const toast = useToast();
  const { t } = useStrings();
  return () => {
    if (!loading && !isPaid && activeCount >= FREE_GOAL_LIMIT) {
      toast.show(t.groupGoals.limit, 'negative');
      router.push('/paywall');
      return;
    }
    router.push(`/group/${groupId}/goal-edit`);
  };
}

function GoalRow({
  view,
  groupId,
  divider,
}: {
  view: GroupGoalView;
  groupId: string;
  divider: boolean;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const { goal, total } = view;
  const pct = goalProgressPct(goal, total);
  const pace = paceLabel(goalPace(goal, total, todayIso()), t.groupGoals);
  const put = goalAmount(total, goal.currency as CurrencyCode, locale);
  const target = goalAmount(goal.targetMinor, goal.currency as CurrencyCode, locale);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${goal.name}. ${t.groupGoals.ringA11y
        .replace('{name}', goal.name)
        .replace('{put}', put)
        .replace('{target}', target)
        .replace('{pct}', String(pct))}${pace ? `. ${pace.text}` : ''}`}
      onPress={() => router.push(`/group/${groupId}/goal/${goal.id}`)}
      style={{
        minHeight: 56,
        paddingVertical: theme.spacing.sm,
        borderTopWidth: divider ? 1 : 0,
        borderTopColor: theme.color.border,
      }}
    >
      <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
        <GoalRing pct={pct} size={36} stroke={5}>
          {goal.emoji ? <Text style={{ fontSize: 14 }}>{goal.emoji}</Text> : null}
        </GoalRing>
        <View style={{ flex: 1 }}>
          <Text variant="body" numberOfLines={1} style={{ fontWeight: '700' }}>
            {goal.name}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {t.groupGoals.rowAmount.replace('{put}', put).replace('{target}', target)}
          </Text>
        </View>
        {pace ? (
          <View
            style={{
              borderRadius: theme.radius.pill,
              paddingHorizontal: theme.spacing.sm + 2,
              paddingVertical: 4,
              backgroundColor:
                pace.tone === 'positive' ? theme.color.positiveSoft : theme.color.negativeSoft,
            }}
          >
            <Text
              variant="micro"
              tone={pace.tone}
              style={{ fontWeight: '700' }}
              accessibilityElementsHidden
            >
              {pace.text}
            </Text>
          </View>
        ) : null}
      </Row>
    </Pressable>
  );
}

export function GroupGoalsCard({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t } = useStrings();
  const { goals } = useGroupGoals(groupId);
  const shown = goals.filter((view) => view.goal.status !== 'archived');
  const active = goals.filter((view) => view.goal.status === 'active').length;
  const add = useAddGoal(groupId, active);
  return (
    <StandardCard>
      {shown.map((view, index) => (
        <GoalRow key={view.goal.id} view={view} groupId={groupId} divider={index > 0} />
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.groupGoals.add}
        onPress={add}
        style={{
          minHeight: 44,
          justifyContent: 'center',
          borderTopWidth: shown.length > 0 ? 1 : 0,
          borderTopColor: theme.color.border,
        }}
      >
        <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
          <Ionicons name="add" size={iconSize.md} color={theme.color.brand} />
          <Text variant="body" tone="brand" style={{ fontWeight: '600' }}>
            {t.groupGoals.add}
          </Text>
        </Row>
      </Pressable>
    </StandardCard>
  );
}
