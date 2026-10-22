/**
 * A group's repeating expenses: the rent, the broadband, the cleaner.
 *
 * A list and four actions per rule — pause or resume, edit, stop. The expenses
 * themselves are posted by the server on their dates (see `data/groupRecurring`),
 * so there is nothing to "post now" here; a paused rule simply posts nothing and
 * resumes from its next date without back-paying the gap. Any live member may
 * change a rule, the way any member may add an expense; editing the wording or
 * the amount makes the editor the author of what posts next.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';

import {
  format,
  frequencyOf,
  money,
  recurringDisplayStatus,
  type CurrencyCode,
  type GroupRecurringRule,
} from '@waves/core';
import {
  Card,
  directionalIcon,
  EmptyState,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  useTheme,
} from '@waves/ui';

import { useGroupRecurring, useUpdateGroupRecurring } from '@/data/groupRecurring';
import { useGroup } from '@/data/hooks';
import { groupLabel } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { useDialog } from '@/lib/dialog';
import { friendlyError } from '@/lib/errors';
import { showDate } from '@/lib/expenseDay';
import { frequencyLabel } from '@/lib/frequencyLabel';
import { router } from '@/lib/navigation';

export default function GroupRecurringScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = id ?? '';
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const { confirm } = useDialog();
  const { group, members } = useGroup(groupId);
  const { rules } = useGroupRecurring(groupId);
  const update = useUpdateGroupRecurring(groupId);
  const [error, setError] = useState<string | null>(null);

  const patch = async (ruleId: string, body: Parameters<typeof update.mutateAsync>[0]['patch']) => {
    setError(null);
    try {
      await update.mutateAsync({ ruleId, patch: body });
    } catch (caught) {
      setError(friendlyError(caught, t.groupRecurring.couldNotSave, 'recurring.update'));
    }
  };

  const stop = async (rule: GroupRecurringRule): Promise<void> => {
    const ok = await confirm({
      title: fill(t.groupRecurring.stopTitle, { name: rule.description }),
      body: t.groupRecurring.stopBody,
      confirmLabel: t.groupRecurring.stop,
      tone: 'danger',
    });
    if (ok) await patch(rule.id, { status: 'stopped' });
  };

  const live = rules.filter((rule) => recurringDisplayStatus(rule) !== 'ended');
  const ended = rules.filter((rule) => recurringDisplayStatus(rule) === 'ended');

  return (
    <Screen>
      <Row style={{ paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md }}>
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="heading">{t.groupRecurring.title}</Text>
          {group.data ? (
            <Text variant="micro" tone="muted">
              {groupLabel(group.data, members.data ?? [])}
            </Text>
          ) : null}
        </View>
        <IconButton
          label={t.addExpense}
          onPress={() => router.push(`/group/${groupId}/add-expense`)}
        >
          <Ionicons name="add" size={iconSize.xxl} color={theme.color.brand} />
        </IconButton>
      </Row>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: clearance,
          gap: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text variant="caption" tone="muted" align="center" style={{ marginTop: theme.spacing.sm }}>
          {t.groupRecurring.sub}
        </Text>
        {error ? (
          <Text variant="caption" tone="negative" align="center">
            {error}
          </Text>
        ) : null}

        {rules.length === 0 ? (
          <View style={{ paddingTop: theme.spacing.xxxl }}>
            <EmptyState title={t.groupRecurring.empty} body={t.groupRecurring.emptyHint} />
          </View>
        ) : null}

        {[...live, ...ended].map((rule) => {
          const status = recurringDisplayStatus(rule);
          const over = status === 'ended';
          return (
            <Card key={rule.id} style={{ gap: theme.spacing.sm, opacity: over ? 0.6 : 1 }}>
              <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Text variant="body" numberOfLines={1} style={{ fontWeight: '600' }}>
                    {rule.description}
                  </Text>
                  <Text variant="micro" tone="muted">
                    {frequencyLabel(t, frequencyOf(rule), rule.interval)}
                    {' · '}
                    {over
                      ? t.groupRecurring.ended
                      : status === 'paused'
                        ? t.groupRecurring.paused
                        : fill(t.groupRecurring.next, { date: showDate(rule.nextDate, locale) })}
                  </Text>
                  {rule.lastGeneratedOn ? (
                    <Text variant="micro" tone="muted">
                      {fill(t.groupRecurring.lastAdded, {
                        date: showDate(rule.lastGeneratedOn, locale),
                      })}
                    </Text>
                  ) : null}
                </View>
                <Text variant="body" style={{ fontWeight: '700' }}>
                  {format(money(rule.amount, rule.currency as CurrencyCode), { locale })}
                </Text>
              </Row>
              {over ? null : (
                <Row style={{ gap: theme.spacing.sm }}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      void patch(rule.id, { status: status === 'paused' ? 'active' : 'paused' })
                    }
                    style={actionStyle(theme)}
                  >
                    <Ionicons
                      name={status === 'paused' ? 'play-outline' : 'pause-outline'}
                      size={iconSize.sm}
                      color={theme.color.brand}
                    />
                    <Text variant="caption" tone="brand">
                      {status === 'paused' ? t.groupRecurring.resume : t.groupRecurring.pause}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      router.push(`/group/${groupId}/recurring-edit?ruleId=${rule.id}`)
                    }
                    style={actionStyle(theme)}
                  >
                    <Ionicons name="create-outline" size={iconSize.sm} color={theme.color.brand} />
                    <Text variant="caption" tone="brand">
                      {t.groupRecurring.edit}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void stop(rule)}
                    style={actionStyle(theme)}
                  >
                    <Ionicons
                      name="stop-circle-outline"
                      size={iconSize.sm}
                      color={theme.color.negative}
                    />
                    <Text variant="caption" tone="negative">
                      {t.groupRecurring.stop}
                    </Text>
                  </Pressable>
                </Row>
              )}
            </Card>
          );
        })}
      </ScrollView>
    </Screen>
  );
}

function actionStyle(theme: ReturnType<typeof useTheme>) {
  return {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceMuted,
  };
}
