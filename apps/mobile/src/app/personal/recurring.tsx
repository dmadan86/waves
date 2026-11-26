import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
// Native confirmation Alert explicitly required for recurring deletion.
// eslint-disable-next-line no-restricted-imports
import { Alert, Image, Pressable, ScrollView, View } from 'react-native';

import {
  encodeRecurring,
  format,
  frequencyOf,
  isRecurringDue,
  money,
  type PersonalRecurring,
} from '@waves/core';
import {
  Button,
  Card,
  Divider,
  ChipRow,
  IconButton,
  iconSize,
  Row,
  Screen,
  Text,
  useTheme,
} from '@waves/ui';

import { CategoryBadge } from '@/components/Category';
import { SourceGlyph, useSourceLabel } from '@/components/IncomeSource';
import { EmptyStateCta } from '@/components/EmptyStateCta';
import {
  filterRecurrings,
  nextDateLabel,
  sectionRecurrings,
  type RecurringFilter,
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
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t, locale } = useStrings();
  const { recurrings } = usePersonalLedger();
  const sourceLabel = useSourceLabel();
  const upsert = useUpsertPersonalRecord();
  const { post, isPending: posting } = usePostRecurring();

  const deletion = useDeletePersonalRecord();
  const [menuRule, setMenuRule] = useState<PersonalRecurring | null>(null);
  const [filter, setFilter] = useState<RecurringFilter>('all');
  const [today] = useState(() => todayIso());

  const cadenceLabel = (rule: PersonalRecurring): string =>
    frequencyLabel(t, frequencyOf(rule), rule.interval);

  const sections = sectionRecurrings(filterRecurrings(recurrings, filter));
  const totals = sectionRecurrings(recurrings.filter((rule) => rule.active));
  const totalCurrency = recurrings[0]?.currency ?? 'INR';
  const moneyText = (amount: bigint) =>
    format(money(amount, totalCurrency), { locale, trimZeros: true });

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
          <Row style={{ alignItems: 'center', gap: theme.spacing.sm, paddingEnd: 104 }}>
            <Text
              style={{ fontSize: 28, lineHeight: 34, fontWeight: '800', color: theme.color.text }}
            >
              {t.personal.recurring}
            </Text>
          </Row>
          <Text
            style={{
              marginTop: 2,
              maxWidth: '56%',
              fontSize: 13,
              lineHeight: 18,
              color: theme.color.textMuted,
            }}
          >
            {t.personal.recurringSub}
          </Text>
        </View>
        <ChipRow<'recurring' | 'budgets' | 'loans'>
          value="recurring"
          onChange={(v) => {
            if (v !== 'recurring')
              router.push(v === 'budgets' ? '/personal/budgets' : '/personal/loans');
          }}
          variant="brand"
          onCard
          options={[
            { value: 'recurring', label: t.personal.recurring },
            { value: 'budgets', label: t.personal.budgets },
            { value: 'loans', label: t.personal.loans },
          ]}
        />
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
        {recurrings.length > 0 ? (
          <Card style={{ padding: theme.spacing.md }}>
            <Text variant="caption" tone="muted">
              {t.personal.eachMonth}
            </Text>
            <Text variant="body" style={{ fontWeight: '700' }}>
              {t.personal.monthSummary
                .replace('{in}', moneyText(totals.incomeTotal))
                .replace('{out}', moneyText(totals.expenseTotal))
                .replace('{left}', moneyText(totals.incomeTotal - totals.expenseTotal))}
            </Text>
          </Card>
        ) : null}
        {[
          {
            key: 'income',
            label: t.personal.moneyIn,
            rules: sections.income,
            total: sections.incomeTotal,
          },
          {
            key: 'expense',
            label: t.personal.moneyOut,
            rules: sections.expense,
            total: sections.expenseTotal,
          },
        ].map((section) =>
          section.rules.length ? (
            <View key={section.key} style={{ gap: theme.spacing.sm }}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Text variant="caption" style={{ fontWeight: '700', color: theme.color.textMuted }}>
                  {section.label}
                </Text>
                <Text variant="micro" tone="muted">
                  {section.key === 'income' ? '+' : ''}
                  {moneyText(section.total)} {t.personal.aMonth}
                </Text>
              </Row>
              {section.rules.map((rule) => {
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
                            <CategoryBadge
                              category={rule.category}
                              size={36}
                              iconOverride={
                                /\bloan\b/i.test(rule.note ?? '') ? 'cash-outline' : undefined
                              }
                            />
                          )}
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text variant="body" numberOfLines={1} style={{ fontWeight: '600' }}>
                              {ruleName(rule)}
                            </Text>
                            <Text
                              variant="micro"
                              tone="muted"
                              numberOfLines={1}
                              ellipsizeMode="tail"
                            >
                              {cadenceLabel(rule)} · {t.personal.nextDue}{' '}
                              {nextDateLabel(rule.nextDate, locale, today)}
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
                              {format(money(rule.amount, rule.currency), {
                                locale,
                                trimZeros: true,
                              })}
                            </Text>
                            {!rule.active ? (
                              <View
                                accessible
                                accessibilityRole="text"
                                accessibilityLabel={
                                  rule.active ? t.personal.active : t.personal.paused
                                }
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
                                    color: rule.active
                                      ? theme.color.positive
                                      : theme.color.textMuted,
                                  }}
                                >
                                  {rule.active ? t.personal.active : t.personal.paused}
                                </Text>
                              </View>
                            ) : null}
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
                            onPress={() => void post(rule)}
                            disabled={upsert.isPending || posting}
                          />
                        </Row>
                      </>
                    ) : null}
                  </Card>
                );
              })}
            </View>
          ) : null,
        )}
        {recurrings.length === 0 ? (
          <EmptyStateCta
            compact
            title={recurrings.length ? t.personal.noMoreRecurring : t.personal.noRecurring}
            body={t.personal.recurringEmptyBody}
            action={t.personal.addRecurringItem}
            onAdd={() =>
              router.push({
                pathname: '/personal/entry',
                params: { repeats: '1', addRecurring: '1' },
              })
            }
          />
        ) : null}
      </ScrollView>
      <OverflowMenu
        visible={menuRule !== null}
        onClose={() => setMenuRule(null)}
        items={
          menuRule
            ? [
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
                      data: encodeRecurring({ ...menuRule, active: !menuRule.active }),
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
