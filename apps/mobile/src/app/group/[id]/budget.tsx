/**
 * A Share-it household's budget: one monthly ceiling for the pot, and a cap per
 * category. The same group-level budget a trip uses (`groups.budget_minor`),
 * read here as "per month". Admins set it; everyone sees it.
 */

import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView } from 'react-native';

import { formatMinorInput, type CurrencyCode } from '@waves/core';
import { AmountField, Button, Card, Row, Screen, Text, useTheme } from '@waves/ui';

import { PlainHeader } from '@/components/standard';
import { CategoryBudgets } from '@/components/CategoryBudgets';
import { withScenicGroup } from '@/components/ScenicScope';
import { useGroup, useGroupBudget, useSetGroupBudget } from '@/data/hooks';
import { todayIso } from '@/data/personal';
import { isViewer } from '@/data/types';
import { useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { useBottomClearance } from '@/lib/clearance';
import { friendlyError } from '@/lib/errors';

function HouseholdBudgetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = id ?? '';
  const theme = useTheme();
  const clearance = useBottomClearance();
  const { t } = useStrings();
  const viewerId = useViewerId();
  const { group, members, expenses } = useGroup(groupId);
  const budget = useGroupBudget(groupId);
  const setBudget = useSetGroupBudget(groupId);
  const currency = group.data?.default_currency ?? 'INR';
  const current = budget.data?.amountMinor ?? null;
  const isAdmin = (members.data ?? []).some(
    (member) => isViewer(member, viewerId) && member.role === 'admin',
  );
  const [amount, setAmount] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = amount ?? current ?? 0n;

  const month = todayIso().slice(0, 7);
  const thisMonth = expenses.rows
    .filter((row) => row.currentVersion && !row.deleted_at)
    .filter((row) => row.currentVersion!.expense_date.slice(0, 7) === month)
    .map((row) => ({
      category: row.currentVersion!.category,
      currency: row.currentVersion!.currency,
      amountMinor: BigInt(row.currentVersion!.amount),
    }));

  const save = async (next: bigint | null): Promise<void> => {
    setError(null);
    try {
      await setBudget.mutateAsync({ amountMinor: next, currency: next === null ? null : currency });
      setAmount(null);
    } catch (caught) {
      setError(friendlyError(caught, t.couldNotSave, 'household.budget'));
    }
  };

  return (
    <Screen edges={[]}>
      <PlainHeader title={t.household.budgetTitle} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: clearance,
          gap: theme.spacing.md,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Card style={{ gap: theme.spacing.sm }}>
          <Text variant="subheading">{t.household.budgetMonthly}</Text>
          <Text variant="caption" tone="muted">
            {t.household.budgetHint}
          </Text>
          {isAdmin ? (
            <>
              <AmountField currency={currency as CurrencyCode} value={shown} onChange={setAmount} />
              <Row style={{ gap: theme.spacing.sm }}>
                <Button
                  label={t.household.budgetSave}
                  size="sm"
                  disabled={setBudget.isPending || amount === null || amount <= 0n}
                  onPress={() => void save(amount)}
                />
                {current !== null ? (
                  <Button
                    label={t.household.budgetClear}
                    size="sm"
                    variant="ghost"
                    disabled={setBudget.isPending}
                    onPress={() => void save(null)}
                  />
                ) : null}
              </Row>
            </>
          ) : (
            <Text variant="subheading">
              {current === null
                ? t.household.noBudget
                : formatMinorInput(current, currency as CurrencyCode)}
            </Text>
          )}
          {error ? (
            <Text variant="caption" tone="negative">
              {error}
            </Text>
          ) : null}
        </Card>
        <CategoryBudgets
          groupId={groupId}
          currency={currency}
          isAdmin={isAdmin}
          expenses={thisMonth}
        />
      </ScrollView>
    </Screen>
  );
}

export default withScenicGroup(HouseholdBudgetScreen);
