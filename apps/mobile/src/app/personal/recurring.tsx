/**
 * Recurring rules (A56): bills and income that repeat — a phone bill, a salary,
 * a subscription. A rule set to "add automatically" posts its entry on its own
 * when due (handled on the Me tab's open); a manual one just shows as due here,
 * to add with one tap.
 *
 * A list, and only a list. The editor that used to live at the bottom of this
 * file was the third form in the private ledger asking the same question — an
 * amount, a direction, what for, a date — in a third shape. It has moved into
 * `personal/entry`, the one form, where repeating is a property of the entry
 * rather than a room you have to be standing in. The "+" here and the pencil on
 * each card open that form; nothing about the rules themselves changed.
 *
 * The list stays its own screen because a list of rules and the form that writes
 * one are different things: this is where you come to ask whether the rent has
 * been arriving, not how it is configured.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, View } from 'react-native';

import {
  encodeRecurring,
  encodeTxn,
  format,
  frequencyOf,
  isRecurringDue,
  money,
  occurrences,
  recurringOccurrenceId,
  stepOccurrence,
  type PersonalRecurring,
} from '@waves/core';
import {
  Button,
  Card,
  directionalIcon,
  Divider,
  EmptyState,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  useTheme,
} from '@waves/ui';

import { useSourceLabel } from '@/components/IncomeSource';
import { OccurrenceStrip } from '@/components/OccurrenceStrip';
import { todayIso, usePersonalLedger, useUpsertPersonalRecord } from '@/data/personal';
import { useStrings } from '@/i18n';
import { PersonalGuard } from '@/components/PersonalGuard';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';
import { frequencyLabel } from '@/lib/frequencyLabel';

function RecurringScreenBody() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const { recurrings, txns } = usePersonalLedger();
  const sourceLabel = useSourceLabel();
  const upsert = useUpsertPersonalRecord();

  const [today] = useState(() => todayIso());

  const cadenceLabel = (rule: PersonalRecurring): string =>
    frequencyLabel(t, frequencyOf(rule), rule.interval);

  // Post one occurrence of a manual rule now, and advance its next date. The
  // occurrence id is deterministic per (rule, date), so this posting the same
  // date the auto catch-up also posts collapses to one row rather than two.
  const postOnce = async (rule: PersonalRecurring): Promise<void> => {
    await upsert.mutateAsync({
      recordId: recurringOccurrenceId(rule.id, rule.nextDate),
      recordKind: 'txn',
      data: encodeTxn({
        kind: rule.txnKind,
        amount: rule.amount,
        currency: rule.currency,
        category: rule.category,
        note: rule.note,
        date: rule.nextDate,
        loanId: null,
        recurringId: rule.id,
      }),
    });
    await upsert.mutateAsync({
      recordId: rule.id,
      recordKind: 'recurring',
      data: encodeRecurring({
        ...rule,
        nextDate: stepOccurrence(rule, rule.nextDate),
      }),
    });
  };

  return (
    <Screen>
      <Row
        style={{
          paddingHorizontal: theme.spacing.xl,
          paddingTop: theme.spacing.md,
          alignItems: 'center',
        }}
      >
        <IconButton label={t.common.back} onPress={() => router.back()}>
          <Ionicons
            name={directionalIcon('chevron-back')}
            size={iconSize.lg}
            color={theme.color.text}
          />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="heading">{t.personal.recurring}</Text>
        </View>
        {/* The one form, opened with its repeat already switched on — the same
            screen the Me tab's add buttons reach, so a rule is written the way
            everything else in this ledger is written. */}
        <IconButton
          label={t.personal.addRecurring}
          onPress={() => router.push({ pathname: '/personal/entry', params: { repeats: '1' } })}
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
        <Text
          variant="caption"
          tone="muted"
          align="center"
          style={{ marginBottom: theme.spacing.sm }}
        >
          {t.personal.recurringSub}
        </Text>

        {recurrings.length === 0 ? (
          <View style={{ paddingTop: theme.spacing.xxxl }}>
            <EmptyState title={t.personal.noRecurring} />
          </View>
        ) : (
          recurrings.map((rule) => {
            const due = isRecurringDue(rule, today);
            const income = rule.txnKind === 'income';
            // The recent history this rule has actually had. A year is plenty to
            // fill the strip and cheap to walk.
            const recent = occurrences(
              rule,
              txns,
              { from: `${Number(today.slice(0, 4)) - 1}${today.slice(4, 7)}-01`, to: today },
              today,
            );
            return (
              <Card key={rule.id} style={{ gap: theme.spacing.sm }}>
                {/* The card opens the rule's history — the question people have
                    about a rent or a salary is whether it has been arriving, not
                    how it is configured. Editing is the pencil. */}
                <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.personal.history}
                    style={{ flex: 1 }}
                    onPress={() => router.push(`/personal/source/${rule.id}`)}
                  >
                    <Row style={{ alignItems: 'center', gap: theme.spacing.md }}>
                      <View style={{ flex: 1 }}>
                        <Text variant="body" numberOfLines={1} style={{ fontWeight: '600' }}>
                          {rule.note?.trim() ||
                            sourceLabel(rule.category) ||
                            (income ? t.personal.incomeKind : t.personal.expense)}
                        </Text>
                        <Text variant="micro" tone="muted">
                          {cadenceLabel(rule)} · {t.personal.nextDue} {rule.nextDate}
                          {rule.active ? '' : ` · ${t.personal.paused}`}
                        </Text>
                        <View style={{ marginTop: theme.spacing.xs }}>
                          <OccurrenceStrip occurrences={recent} />
                        </View>
                      </View>
                      {/* Sign and colour together, never one alone: an income
                          and an expense that differ only by a thin green are
                          the same row to anybody reading quickly. Expense keeps
                          the plain ink rather than red — a list where every
                          spend is red is a wall of red that says nothing. */}
                      <Text
                        variant="body"
                        style={{
                          fontWeight: '700',
                          color: income ? theme.color.positive : theme.color.text,
                        }}
                      >
                        {income ? '+' : '−'}
                        {format(money(rule.amount, rule.currency), {
                          locale,
                        })}
                      </Text>
                    </Row>
                  </Pressable>
                  <IconButton
                    label={t.personal.editRecurring}
                    onPress={() =>
                      router.push({
                        pathname: '/personal/entry',
                        params: { recurringId: rule.id },
                      })
                    }
                  >
                    <Ionicons
                      name="create-outline"
                      size={iconSize.md}
                      color={theme.color.textMuted}
                    />
                  </IconButton>
                </Row>
                {due && !rule.autoPost && rule.active ? (
                  <>
                    <Divider />
                    <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text variant="caption" tone="brand" style={{ fontWeight: '600' }}>
                        {t.personal.due}
                      </Text>
                      <Button
                        label={t.personal.postNow}
                        size="sm"
                        onPress={() => void postOnce(rule)}
                        disabled={upsert.isPending}
                      />
                    </Row>
                  </>
                ) : null}
              </Card>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

/**
 * Behind the section shield: one unlock covers the Me tab and every room
 * under `personal/`, so arriving here from the ledger never asks again.
 */
export default function RecurringScreen() {
  return (
    <PersonalGuard>
      <RecurringScreenBody />
    </PersonalGuard>
  );
}
