import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
// Native confirmation Alert explicitly required for recurring deletion.
// eslint-disable-next-line no-restricted-imports
import { Alert, Image, Pressable, ScrollView, View } from 'react-native';

import {
  encodeRecurring,
  encodeTxn,
  format,
  frequencyOf,
  isRecurringDue,
  money,
  recurringOccurrenceId,
  stepOccurrence,
  type PersonalRecurring,
} from '@waves/core';
import {
  Button,
  Card,
  directionalIcon,
  Divider,
  ChipRow,
  IconButton,
  iconSize,
  Row,
  Screen,
  Sheet,
  Text,
  useTheme,
} from '@waves/ui';

import { CategoryBadge } from '@/components/Category';
import { SourceGlyph, useSourceLabel } from '@/components/IncomeSource';
import { EmptyStateCta } from '@/components/EmptyStateCta';
import { filterRecurrings, nextDateLabel, type RecurringFilter } from '@/lib/recurringList';
import {
  todayIso,
  useDeletePersonalRecord,
  usePersonalLedger,
  useUpsertPersonalRecord,
} from '@/data/personal';
import { useStrings } from '@/i18n';
import { PersonalGuard } from '@/components/PersonalGuard';
import { useBottomClearance } from '@/lib/clearance';
import { router } from '@/lib/navigation';
import { frequencyLabel } from '@/lib/frequencyLabel';

function RecurringScreenBody() {
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const { recurrings } = usePersonalLedger();
  const sourceLabel = useSourceLabel();
  const upsert = useUpsertPersonalRecord();

  const deletion = useDeletePersonalRecord();
  const [menuRule, setMenuRule] = useState<PersonalRecurring | null>(null);
  const [filter, setFilter] = useState<RecurringFilter>('all');
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

  const ruleName = (rule: PersonalRecurring) =>
    rule.note?.trim() ||
    sourceLabel(rule.category) ||
    (rule.txnKind === 'income' ? t.personal.incomeKind : t.personal.expense);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance + 72,
          gap: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingTop: theme.spacing.sm, minHeight: 104 }}>
          <Image
            source={require('../../../assets/images/personal-bills.webp')}
            resizeMode="contain"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ position: 'absolute', top: theme.spacing.xs, end: 0, width: 96, height: 96 }}
          />
          <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
            <IconButton label={t.common.back} onPress={() => router.back()}>
              <Ionicons
                name={directionalIcon('chevron-back')}
                size={iconSize.lg}
                color={theme.color.text}
              />
            </IconButton>
            <Text
              style={{ fontSize: 28, lineHeight: 34, fontWeight: '800', color: theme.color.text }}
            >
              {t.personal.recurring}
            </Text>
          </Row>
          <Text
            style={{
              marginTop: 2,
              marginStart: 48,
              maxWidth: '56%',
              fontSize: 13,
              lineHeight: 18,
              color: theme.color.textMuted,
            }}
          >
            {t.personal.recurringSub}
          </Text>
        </View>
        <View accessibilityLabel={t.personal.recurringFilterLabel}>
          <ChipRow<RecurringFilter>
            value={filter}
            onChange={setFilter}
            variant="brand"
            onCard
            options={[
              { value: 'all', label: t.personal.all },
              { value: 'bills', label: t.personal.recurringBills },
              { value: 'income', label: t.personal.incomeKind },
              { value: 'active', label: t.personal.active },
              { value: 'paused', label: t.personal.paused },
            ]}
          />
        </View>
        {filterRecurrings(recurrings, filter).map((rule) => {
          const due = isRecurringDue(rule, today);
          const income = rule.txnKind === 'income';
          return (
            <Card
              key={rule.id}
              style={{ gap: theme.spacing.sm, padding: theme.spacing.md, borderRadius: 20 }}
            >
              <Row style={{ alignItems: 'center', gap: theme.spacing.xs }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${ruleName(rule)} · ${t.personal.history}`}
                  style={{ flex: 1 }}
                  onPress={() => router.push(`/personal/source/${rule.id}`)}
                >
                  <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
                    {income ? (
                      <SourceGlyph id={rule.category} size={36} />
                    ) : (
                      <CategoryBadge category={rule.category} size={36} />
                    )}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text variant="body" numberOfLines={1} style={{ fontWeight: '600' }}>
                        {ruleName(rule)}
                      </Text>
                      <Text variant="micro" tone="muted">
                        {cadenceLabel(rule)} · {t.personal.nextDue}{' '}
                        {nextDateLabel(rule.nextDate, locale)}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Text
                        variant="body"
                        style={{
                          fontWeight: '700',
                          color: income ? theme.color.positive : theme.color.text,
                        }}
                      >
                        {income ? '+' : '−'}
                        {format(money(rule.amount, rule.currency), { locale })}
                      </Text>
                      <View
                        accessible
                        accessibilityRole="text"
                        accessibilityLabel={rule.active ? t.personal.active : t.personal.paused}
                        style={{
                          borderRadius: theme.radius.pill,
                          paddingHorizontal: 8,
                          paddingVertical: 2,
                          backgroundColor: rule.active
                            ? theme.color.positiveSoft
                            : theme.color.surfaceMuted,
                        }}
                      >
                        <Text
                          variant="micro"
                          style={{
                            color: rule.active ? theme.color.positive : theme.color.textMuted,
                          }}
                        >
                          {rule.active ? t.personal.active : t.personal.paused}
                        </Text>
                      </View>
                    </View>
                  </Row>
                </Pressable>
                <IconButton
                  label={`${t.personal.recurringMenuLabel}: ${ruleName(rule)}`}
                  repeatable
                  onPress={() => setMenuRule(rule)}
                >
                  <Ionicons
                    name="ellipsis-vertical"
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
        })}
        <EmptyStateCta
          compact
          title={recurrings.length ? t.personal.noMoreRecurring : t.personal.noRecurring}
          body={t.personal.recurringEmptyBody}
          action={t.personal.addRecurringItem}
          onAdd={() => router.push({ pathname: '/personal/entry', params: { repeats: '1' } })}
        />
      </ScrollView>
      <Sheet visible={menuRule !== null} onClose={() => setMenuRule(null)}>
        {menuRule ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="heading">{ruleName(menuRule)}</Text>
            <Button
              label={t.personal.editRecurring}
              onPress={() => {
                setMenuRule(null);
                router.push({ pathname: '/personal/entry', params: { recurringId: menuRule.id } });
              }}
            />
            <Button
              label={menuRule.active ? t.personal.pauseRecurring : t.personal.resumeRecurring}
              disabled={upsert.isPending}
              onPress={() => {
                upsert.mutate({
                  recordId: menuRule.id,
                  recordKind: 'recurring',
                  data: encodeRecurring({ ...menuRule, active: !menuRule.active }),
                });
                setMenuRule(null);
              }}
            />
            <Button
              label={t.common.delete}
              disabled={deletion.isPending}
              onPress={() => {
                const id = menuRule.id;
                setMenuRule(null);
                // eslint-disable-next-line no-restricted-syntax -- Native delete confirmation requested for this screen.
                Alert.alert(t.personal.deleteRecurringTitle, t.personal.deleteRecurringBody, [
                  { text: t.common.cancel, style: 'cancel' },
                  {
                    text: t.common.delete,
                    style: 'destructive',
                    onPress: () => deletion.mutate(id),
                  },
                ]);
              }}
            />
            <Button label={t.common.cancel} onPress={() => setMenuRule(null)} />
          </View>
        ) : null}
      </Sheet>
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
