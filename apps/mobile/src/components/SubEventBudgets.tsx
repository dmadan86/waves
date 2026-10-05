/**
 * Event budget (docs/event-organizer.md): a planned amount per sub-event —
 * Mehendi, Sangeet, Wedding, Reception — beside what the ledger says was
 * actually spent under each tag.
 *
 * Deliberately not a new synced primitive. A sub-event's cap rides the same
 * group row's `category_budgets` map a trip's per-category cap already does
 * (`waves_set_category_budget`, `useCategoryBudgets`/`useSetCategoryBudget`),
 * keyed by the sub-event id instead of a category id — the two never collide,
 * because an Event group's expenses are tagged with a sub-event, not a
 * spending category, and the map does not care which kind of key it holds.
 * "Spent" comes from {@link spendBySubEvent} rather than `spendByCategory`,
 * which is the one piece of new maths this needed.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';

import {
  budgetProgress,
  spendBySubEvent,
  type EventSubEventDef,
  type SubEventExpense,
} from '@waves/core';
import { AmountField, Button, Card, iconSize, MoneyText, Row, Text, useTheme } from '@waves/ui';
import { Pressable, View } from 'react-native';

import { useCategoryBudgets, useSetCategoryBudget } from '@/data/hooks';
import { friendlyError } from '@/lib/errors';
import { useStrings } from '@/i18n';

export function SubEventBudgets({
  groupId,
  currency,
  isAdmin,
  expenses,
  subEvents,
}: {
  groupId: string;
  currency: string;
  isAdmin: boolean;
  expenses: readonly SubEventExpense[];
  /** The fixed sub-events the group's template suggests. */
  subEvents: readonly EventSubEventDef[];
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const budgets = useCategoryBudgets(groupId);
  const setBudget = useSetCategoryBudget(groupId);

  const spend = spendBySubEvent(expenses);
  // Only the rows that match a sub-event this template knows — a stray
  // category-shaped key (there should never be one once a group has a
  // template) is silently ignored rather than shown with no label.
  const bySubEventId = new Map(subEvents.map((subEvent) => [subEvent.id, subEvent]));
  const rows = (budgets.data ?? []).filter((row) => bySubEventId.has(row.category));
  const unbudgeted = subEvents.filter(
    (subEvent) => !rows.some((row) => row.category === subEvent.id),
  );

  const [adding, setAdding] = useState(false);
  const [subEventId, setSubEventId] = useState<string | null>(null);
  const [amount, setAmount] = useState<bigint>(0n);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = (id: string): string =>
    `${bySubEventId.get(id)?.emoji ?? ''} ${t.eventSubEvents[id] ?? id}`.trim();

  const save = async (): Promise<void> => {
    if (!subEventId) return;
    setBusy(true);
    setError(null);
    try {
      await setBudget.mutateAsync({ category: subEventId, amountMinor: amount, currency });
      setAdding(false);
      setSubEventId(null);
      setAmount(0n);
    } catch (caught) {
      setError(friendlyError(caught, t.couldNotSave, 'subEventBudget.save'));
    } finally {
      setBusy(false);
    }
  };

  const clear = async (id: string): Promise<void> => {
    setError(null);
    try {
      await setBudget.mutateAsync({ category: id, amountMinor: null });
    } catch (caught) {
      setError(friendlyError(caught, t.couldNotSave, 'subEventBudget.clear'));
    }
  };

  // Nothing set and not an admin: the section would be an empty box. Hide it.
  if (rows.length === 0 && !isAdmin) return null;

  return (
    <Card style={{ gap: theme.spacing.sm, paddingVertical: theme.spacing.md }}>
      <Text variant="subheading">{t.eventOrganizer.budgetTitle}</Text>

      {error ? (
        <Text variant="caption" tone="negative">
          {error}
        </Text>
      ) : null}

      {rows.map((row) => {
        const progress = budgetProgress(
          { amountMinor: row.amountMinor, currency: row.currency },
          spend.get(row.category),
        );
        if (!progress) return null;
        const fill = Math.max(0, Math.min(1, progress.ratio));
        const color = progress.over ? theme.color.negative : theme.color.positive;
        const gap =
          progress.remainingMinor < 0n ? -progress.remainingMinor : progress.remainingMinor;
        return (
          <View key={row.category} style={{ gap: theme.spacing.xs }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Text variant="caption" numberOfLines={1} style={{ flex: 1 }}>
                {label(row.category)}
              </Text>
              <Row style={{ gap: theme.spacing.xs, alignItems: 'center' }}>
                <MoneyText
                  amount={progress.spentMinor}
                  currency={progress.currency}
                  locale={locale}
                  variant="caption"
                  mode="plain"
                />
                <Text variant="caption" tone="faint">
                  /
                </Text>
                <MoneyText
                  amount={progress.capMinor}
                  currency={progress.currency}
                  locale={locale}
                  variant="caption"
                  mode="plain"
                />
                {isAdmin ? (
                  <Pressable
                    onPress={() => void clear(row.category)}
                    accessibilityRole="button"
                    accessibilityLabel={`${t.clearBudget} — ${label(row.category)}`}
                    hitSlop={10}
                  >
                    <Ionicons name="close" size={iconSize.sm} color={theme.color.textFaint} />
                  </Pressable>
                ) : null}
              </Row>
            </Row>
            <View
              style={{
                height: 8,
                borderRadius: 4,
                backgroundColor: theme.color.border,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  width: `${fill * 100}%`,
                  height: '100%',
                  backgroundColor: color,
                  borderRadius: 4,
                }}
              />
            </View>
            <Row style={{ gap: theme.spacing.xs, alignItems: 'center' }}>
              <MoneyText
                amount={gap}
                currency={progress.currency}
                locale={locale}
                variant="micro"
                mode="plain"
              />
              <Text variant="micro" tone={progress.over ? 'negative' : 'muted'}>
                {progress.over ? t.overBudget : t.budgetLeft}
              </Text>
            </Row>
          </View>
        );
      })}

      {isAdmin && adding ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Row style={{ gap: theme.spacing.sm, flexWrap: 'wrap' }}>
            {unbudgeted.map((subEvent) => (
              <Pressable
                key={subEvent.id}
                onPress={() => setSubEventId(subEvent.id)}
                accessibilityRole="button"
                accessibilityLabel={label(subEvent.id)}
                style={{
                  paddingHorizontal: theme.spacing.md,
                  height: 36,
                  borderRadius: theme.radius.pill,
                  justifyContent: 'center',
                  backgroundColor:
                    subEventId === subEvent.id ? theme.color.buttonPrimary : theme.color.surface,
                }}
              >
                <Text
                  variant="caption"
                  style={{
                    color:
                      subEventId === subEvent.id
                        ? theme.color.onButtonPrimary
                        : theme.color.textMuted,
                  }}
                >
                  {label(subEvent.id)}
                </Text>
              </Pressable>
            ))}
          </Row>
          <AmountField currency={currency} value={amount} onChange={setAmount} />
          <Row style={{ gap: theme.spacing.sm }}>
            <Button
              label={t.saveBudget}
              size="sm"
              disabled={busy || !subEventId}
              onPress={() => void save()}
            />
            <Button
              label={t.cancel}
              size="sm"
              variant="ghost"
              onPress={() => {
                setAdding(false);
                setSubEventId(null);
                setAmount(0n);
              }}
            />
          </Row>
        </View>
      ) : isAdmin && unbudgeted.length > 0 ? (
        <Button
          label={
            rows.length === 0
              ? t.eventOrganizer.addEventBudget
              : `+ ${t.eventOrganizer.budgetTitle}`
          }
          size="sm"
          variant="secondary"
          fullWidth
          onPress={() => setAdding(true)}
        />
      ) : null}
    </Card>
  );
}
