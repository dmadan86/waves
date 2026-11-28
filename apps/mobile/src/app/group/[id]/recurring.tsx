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
import { ScrollView, View } from 'react-native';

import {
  format,
  frequencyOf,
  money,
  recurringDisplayStatus,
  type CurrencyCode,
  type GroupRecurringRule,
} from '@waves/core';
import {
  directionalIcon,
  EmptyState,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  useTheme,
} from '@waves/ui';

import { OverflowMenu } from '@/components/OverflowMenu';
import { withScenicGroup } from '@/components/ScenicScope';
import { ListCard, ListItem, RowTile } from '@/components/standard';
import { useGroupRecurring, useUpdateGroupRecurring } from '@/data/groupRecurring';
import { useGroup } from '@/data/hooks';
import { useCompanyGroupGuard } from '@/lib/useCompanyGroupGuard';
import { groupLabel } from '@/data/types';
import { fill, useStrings } from '@/i18n';
import { useBottomClearance } from '@/lib/clearance';
import { useDialog } from '@/lib/dialog';
import { friendlyError } from '@/lib/errors';
import { showDate } from '@/lib/expenseDay';
import { frequencyLabel } from '@/lib/frequencyLabel';
import { router } from '@/lib/navigation';

function GroupRecurringScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = id ?? '';
  useCompanyGroupGuard(groupId);
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const { confirm } = useDialog();
  const { group, members } = useGroup(groupId);
  const { rules } = useGroupRecurring(groupId);
  const update = useUpdateGroupRecurring(groupId);
  const [error, setError] = useState<string | null>(null);
  const [menuRule, setMenuRule] = useState<{
    rule: GroupRecurringRule;
    status: ReturnType<typeof recurringDisplayStatus>;
  } | null>(null);

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

        {rules.length ? (
          <ListCard>
            {[...live, ...ended].map((rule, index) => {
              const status = recurringDisplayStatus(rule);
              const over = status === 'ended';
              return (
                <ListItem
                  key={rule.id}
                  divider={index > 0}
                  leading={
                    <RowTile tint={theme.color.brandSoft}>
                      <Ionicons
                        name="repeat-outline"
                        size={iconSize.lg}
                        color={over ? theme.color.textMuted : theme.color.brand}
                      />
                    </RowTile>
                  }
                  title={rule.description}
                  subtitle={
                    <View>
                      <Text variant="caption" tone="muted" numberOfLines={1}>
                        {frequencyLabel(t, frequencyOf(rule), rule.interval)}
                        {' · '}
                        {over
                          ? t.groupRecurring.ended
                          : status === 'paused'
                            ? t.groupRecurring.paused
                            : fill(t.groupRecurring.next, {
                                date: showDate(rule.nextDate, locale),
                              })}
                      </Text>
                      {rule.lastGeneratedOn ? (
                        <Text variant="caption" tone="muted" numberOfLines={1}>
                          {fill(t.groupRecurring.lastAdded, {
                            date: showDate(rule.lastGeneratedOn, locale),
                          })}
                        </Text>
                      ) : null}
                    </View>
                  }
                  amount={format(money(rule.amount, rule.currency as CurrencyCode), { locale })}
                  amountTone={over ? 'muted' : undefined}
                  trailing={
                    over ? undefined : (
                      <IconButton
                        label={`${t.group.more}: ${rule.description}`}
                        repeatable
                        onPress={() => setMenuRule({ rule, status })}
                      >
                        <Ionicons
                          name="ellipsis-vertical"
                          size={iconSize.md}
                          color={theme.color.textMuted}
                        />
                      </IconButton>
                    )
                  }
                />
              );
            })}
          </ListCard>
        ) : null}
      </ScrollView>
      <OverflowMenu
        visible={menuRule !== null}
        onClose={() => setMenuRule(null)}
        items={
          menuRule
            ? [
                {
                  icon: menuRule.status === 'paused' ? 'play-outline' : 'pause-outline',
                  label:
                    menuRule.status === 'paused' ? t.groupRecurring.resume : t.groupRecurring.pause,
                  onPress: () =>
                    void patch(menuRule.rule.id, {
                      status: menuRule.status === 'paused' ? 'active' : 'paused',
                    }),
                },
                {
                  icon: 'create-outline',
                  label: t.groupRecurring.edit,
                  onPress: () =>
                    router.push(`/group/${groupId}/recurring-edit?ruleId=${menuRule.rule.id}`),
                },
                {
                  icon: 'stop-circle-outline',
                  label: t.groupRecurring.stop,
                  tone: 'danger',
                  onPress: () => void stop(menuRule.rule),
                },
              ]
            : []
        }
      />
    </Screen>
  );
}

export default withScenicGroup(GroupRecurringScreen);
