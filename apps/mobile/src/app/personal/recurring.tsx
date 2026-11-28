import { useState } from 'react';
import { useIsFocused } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
// Native confirmation Alert explicitly required for recurring deletion.
// eslint-disable-next-line no-restricted-imports
import { Alert, ScrollView, View } from 'react-native';

import {
  encodeRecurring,
  format,
  frequencyOf,
  isRecurringDue,
  money,
  type PersonalRecurring,
  skipOverdueOccurrences,
} from '@waves/core';
import { IconButton, iconSize, Row, Screen, Text, useTheme } from '@waves/ui';

import { KindPills } from '@/components/KindPills';
import { PlanningHeader, PlanningTabs } from '@/components/PlanningTabs';
import { LIST_TILE, ListCard, ListItem, StandardCard } from '@/components/standard';
import { CategoryBadge } from '@/components/Category';
import { SourceGlyph, useSourceLabel } from '@/components/IncomeSource';
import { EmptyStateCta } from '@/components/EmptyStateCta';
import {
  nextDateLabel,
  recurringTab,
  recurringTabMemory,
  sectionRecurrings,
} from '@/lib/recurringList';
import { usePostRecurring } from '@/data/postRecurring';
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
import { OverflowMenu } from '@/components/OverflowMenu';

function RecurringScreenBody() {
  const focused = useIsFocused();
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const { recurrings } = usePersonalLedger();
  const sourceLabel = useSourceLabel();
  const upsert = useUpsertPersonalRecord();
  const { post, isPending: posting } = usePostRecurring();

  const deletion = useDeletePersonalRecord();
  const [menuRule, setMenuRule] = useState<PersonalRecurring | null>(null);
  const [tab, setTab] = useState<'expense' | 'income'>(recurringTabMemory.tab);
  // Coming back from a save of the other kind lands on the tab that shows it.
  const [wasFocused, setWasFocused] = useState(focused);
  if (focused !== wasFocused) {
    setWasFocused(focused);
    if (focused) setTab(recurringTabMemory.tab);
  }
  const [today] = useState(() => todayIso());

  const cadenceLabel = (rule: PersonalRecurring): string =>
    frequencyLabel(t, frequencyOf(rule), rule.interval);

  const totalCurrency = recurrings[0]?.currency ?? 'INR';
  const moneyText = (amount: bigint) =>
    format(money(amount, totalCurrency), { locale, trimZeros: true });

  const ruleName = (rule: PersonalRecurring) =>
    rule.note?.trim() ||
    sourceLabel(rule.category) ||
    (rule.txnKind === 'income' ? t.personal.incomeKind : t.personal.expense);

  const view = recurringTab(recurrings, tab);
  const totals = sectionRecurrings(recurrings.filter((rule) => rule.active));
  const addRule = (): void =>
    router.push({
      pathname: '/personal/entry',
      params: { repeats: '1', addRecurring: '1', kind: tab },
    });
  const stat = (label: string, value: bigint, first = false): React.JSX.Element => (
    <View
      style={{
        flex: 1,
        gap: 2,
        paddingStart: theme.spacing.sm,
        borderStartWidth: first ? 0 : 1,
        borderStartColor: theme.color.border,
      }}
    >
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text variant="body" numberOfLines={1} adjustsFontSizeToFit style={{ fontWeight: '700' }}>
        {moneyText(value)}
      </Text>
    </View>
  );

  return (
    <Screen edges={[]}>
      <PlanningHeader
        tab="recurring"
        title={t.personal.recurring}
        subtitle={t.personal.recurringSub}
        addLabel={t.personal.addRecurringItem.replace(/^\+\s*/, '')}
        onAdd={addRule}
      />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: clearance,
          gap: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        <PlanningTabs value="recurring" />
        {recurrings.length > 0 ? (
          <StandardCard style={{ gap: theme.spacing.md }}>
            <Text variant="body" style={{ fontWeight: '700' }}>
              {t.personal.monthTitle}
            </Text>
            <Row>
              {stat(t.personal.moneyIn, totals.incomeTotal, true)}
              {stat(t.personal.moneyOut, totals.expenseTotal)}
              {stat(t.personal.leftLabel, totals.incomeTotal - totals.expenseTotal)}
            </Row>
          </StandardCard>
        ) : null}
        <KindPills
          value={tab}
          onChange={(next) => {
            recurringTabMemory.tab = next;
            setTab(next);
          }}
          expenseLabel={`${t.personal.expense} · ${view.counts.expense}`}
          incomeLabel={`${t.personal.incomeKind} · ${view.counts.income}`}
        />
        {[{ key: tab, rules: view.rules }].map((section) =>
          section.rules.length ? (
            <ListCard key={section.key}>
              {section.rules.map((rule, index) => {
                const due = isRecurringDue(rule, today);
                const income = rule.txnKind === 'income';
                return (
                  <ListItem
                    key={rule.id}
                    divider={index > 0}
                    accessibilityLabel={`${ruleName(rule)} · ${t.personal.history}`}
                    onPress={() => router.push(`/personal/source/${rule.id}`)}
                    leading={
                      income ? (
                        <SourceGlyph id={rule.category} size={LIST_TILE} />
                      ) : (
                        <CategoryBadge
                          category={rule.category}
                          size={LIST_TILE}
                          iconOverride={
                            /\bloan\b/i.test(rule.note ?? '') ? 'cash-outline' : undefined
                          }
                        />
                      )
                    }
                    title={ruleName(rule)}
                    subtitle={`${cadenceLabel(rule)} · ${t.personal.nextDue} ${nextDateLabel(rule.nextDate, locale, today)}`}
                    amount={`${income ? '+' : '−'}${format(money(rule.amount, rule.currency), {
                      locale,
                      trimZeros: true,
                    })}`}
                    amountColor={income ? theme.color.positive : undefined}
                    caption={
                      !rule.active
                        ? t.personal.paused
                        : due && !rule.autoPost
                          ? t.personal.due
                          : undefined
                    }
                    captionTone={!rule.active ? 'muted' : 'brand'}
                    trailing={
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
                    }
                  />
                );
              })}
            </ListCard>
          ) : null,
        )}
        {view.rules.length === 0 ? (
          <EmptyStateCta
            compact
            title={tab === 'income' ? t.personal.noRecurringIncome : t.personal.noRecurringExpense}
            body={t.personal.recurringEmptyBody}
            action={t.personal.addRecurringItem.replace(/^\+\s*/, '')}
            onAdd={addRule}
          />
        ) : null}
      </ScrollView>
      <OverflowMenu
        visible={menuRule !== null}
        onClose={() => setMenuRule(null)}
        items={
          menuRule
            ? [
                ...(isRecurringDue(menuRule, today) && !menuRule.autoPost && menuRule.active
                  ? [
                      {
                        icon: 'checkmark-done-outline' as const,
                        label: t.personal.postNow,
                        onPress: () => {
                          if (!upsert.isPending && !posting) void post(menuRule);
                        },
                      },
                    ]
                  : []),
                {
                  icon: 'create-outline',
                  label: t.personal.editRecurring,
                  onPress: () =>
                    router.push({
                      pathname: '/personal/entry',
                      params: { recurringId: menuRule.id },
                    }),
                },
                {
                  icon: menuRule.active ? 'pause-outline' : 'play-outline',
                  label: menuRule.active ? t.personal.pauseRecurring : t.personal.resumeRecurring,
                  onPress: () =>
                    upsert.mutate({
                      recordId: menuRule.id,
                      recordKind: 'recurring',
                      data: encodeRecurring({
                        ...menuRule,
                        active: !menuRule.active,
                        ...(!menuRule.active
                          ? { nextDate: skipOverdueOccurrences(menuRule, today) }
                          : {}),
                      }),
                    }),
                },
                {
                  icon: 'trash-outline',
                  label: t.common.delete,
                  tone: 'danger',
                  onPress: () => {
                    const id = menuRule.id;
                    // eslint-disable-next-line no-restricted-syntax -- Native confirmation is required for recurring deletion.
                    Alert.alert(t.personal.deleteRecurringTitle, t.personal.deleteRecurringBody, [
                      { text: t.common.cancel, style: 'cancel' },
                      {
                        text: t.common.delete,
                        style: 'destructive',
                        onPress: () => deletion.mutate(id),
                      },
                    ]);
                  },
                },
              ]
            : []
        }
      />
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
