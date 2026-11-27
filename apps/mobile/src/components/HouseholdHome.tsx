/**
 * The Share-it group home: "Our November" (spend against the household's monthly
 * budget, with "Who paid" one tap down) and the shared bills. The money tools sit below,
 * in the parent screen's slot.
 */
import { Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format, money, type CurrencyCode, type GroupRecurringRule } from '@waves/core';
import { Card, directionalIcon, iconSize, Text, useTheme } from '@waves/ui';

import { CategoryBadge } from '@/components/Category';
import { RentalsRow } from '@/components/household/RentalsRow';
import { VehiclesRow } from '@/components/household/VehiclesRow';
import { fill, useStrings } from '@/i18n';
import { billPayer, billWhen, monthProgress } from '@/lib/householdHome';
import { router } from '@/lib/navigation';

export function HouseholdHome({
  groupId,
  currency,
  spent,
  budget,
  rules,
  nameOf,
  onWhoPaid,
  rentals,
}: {
  groupId: string;
  currency: string;
  spent: bigint;
  budget: bigint | null;
  rules: readonly GroupRecurringRule[];
  nameOf: (memberId: string | null) => string;
  onWhoPaid: () => void;
  /** Couple/home groups only: the group's own rentals. */
  rentals?: { count: number; received: bigint };
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const cur = currency as CurrencyCode;
  const amountText = (minor: bigint): string =>
    format(money(minor, cur), { locale, trimZeros: true });
  const progress = monthProgress(spent, budget);
  const month = new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date());
  const active = rules.filter((rule) => rule.status === 'active');

  const whenText = (rule: GroupRecurringRule): string => {
    const when = billWhen(rule);
    if (when.kind === 'date')
      return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(
        new Date(`${when.date}T12:00:00`),
      );
    switch (when.every) {
      case 'week':
        return t.household.everyWeek;
      case 'twoWeeks':
        return t.household.everyTwoWeeks;
      case 'twiceMonth':
        return t.household.twiceMonth;
      case 'year':
        return t.household.everyYear;
      default:
        return fill(t.household.everyMonths, { n: when.n });
    }
  };

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Card style={{ gap: theme.spacing.xs }}>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Text variant="subheading" accessibilityRole="header">
            {fill(t.household.ourMonth, { month })}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.household.whoPaidA11y}
            onPress={onWhoPaid}
            hitSlop={10}
            style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}
          >
            <Text style={{ color: theme.color.brand, fontWeight: '700', fontSize: 15 }}>
              {t.household.whoPaid}
            </Text>
            <Ionicons
              name={directionalIcon('chevron-forward')}
              size={iconSize.base}
              color={theme.color.brand}
            />
          </Pressable>
        </View>
        <View
          style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}
        >
          <Text
            style={{ fontSize: 28, lineHeight: 34, fontWeight: '800', color: theme.color.text }}
          >
            {amountText(spent)}
          </Text>
          {progress.hasBudget && budget !== null ? (
            <Text variant="caption" tone="muted">
              {fill(t.household.ofBudget, { amount: amountText(budget) })}
            </Text>
          ) : null}
        </View>
        {progress.hasBudget ? (
          <>
            <View
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: Math.round(progress.fraction * 100) }}
              style={{
                height: 6,
                borderRadius: 3,
                backgroundColor: theme.color.border,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  width: `${Math.round(progress.fraction * 100)}%`,
                  height: 6,
                  backgroundColor: progress.onTrack ? theme.color.brand : theme.color.negative,
                }}
              />
            </View>
            <Text
              style={{
                fontSize: 15,
                fontWeight: '700',
                color: progress.onTrack ? theme.color.positive : theme.color.negative,
              }}
            >
              {progress.onTrack
                ? fill(t.household.leftOnTrack, { amount: amountText(progress.left) })
                : fill(t.household.overBy, { amount: amountText(progress.over) })}
            </Text>
          </>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.household.noBudget}
            onPress={() => router.push(`/group/${groupId}/budget`)}
            hitSlop={8}
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Text style={{ color: theme.color.brand, fontWeight: '700', fontSize: 15 }}>
              {t.household.noBudget}
            </Text>
          </Pressable>
        )}
      </Card>

      {active.length > 0 ? (
        <Card padded={false} style={{ paddingHorizontal: theme.spacing.lg }}>
          {active.map((rule, index) => (
            <Pressable
              key={rule.id}
              accessibilityRole="button"
              accessibilityLabel={`${rule.description}, ${fill(t.household.billPays, {
                name: nameOf(billPayer(rule.payers)),
                when: whenText(rule),
              })}, ${amountText(rule.amount)}`}
              onPress={() => router.push(`/group/${groupId}/recurring`)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
                paddingVertical: theme.spacing.md,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: theme.color.border,
              }}
            >
              <CategoryBadge category={rule.category} description={rule.description} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: 17, fontWeight: '700', color: theme.color.text }}
                >
                  {rule.description}
                </Text>
                <Text numberOfLines={1} variant="caption" tone="muted">
                  {fill(t.household.billPays, {
                    name: nameOf(billPayer(rule.payers)),
                    when: whenText(rule),
                  })}
                </Text>
              </View>
              <Text style={{ fontSize: 17, fontWeight: '800', color: theme.color.text }}>
                {amountText(rule.amount)}
              </Text>
            </Pressable>
          ))}
        </Card>
      ) : null}

      {rentals ? (
        <RentalsRow
          groupId={groupId}
          count={rentals.count}
          amountText={amountText(rentals.received)}
        />
      ) : null}
      {rentals ? <VehiclesRow groupId={groupId} /> : null}
    </View>
  );
}
