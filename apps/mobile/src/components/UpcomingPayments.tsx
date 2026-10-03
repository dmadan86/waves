/**
 * "Upcoming payments" (docs/event-organizer.md): a compact list of the
 * vendor deposits still owing a balance on this group — soonest/overdue
 * first. All the maths lives in `lib/upcomingPayments`; this only draws it.
 */

import { Badge, Card, MoneyText, Row, Text, useTheme } from '@waves/ui';
import { Pressable, View } from 'react-native';

import { overdueCount, upcomingPayments, type DepositCandidate } from '@/lib/upcomingPayments';
import { showDate } from '@/lib/expenseDay';
import { router } from '@/lib/navigation';
import { plural, useStrings } from '@/i18n';

/** How many rows the compact card shows before the rest wait for the full
 *  expense list — a reminder, not a ledger. */
const MAX_ROWS = 4;

export function UpcomingPayments({
  groupId,
  expenses,
  today,
}: {
  groupId: string;
  expenses: readonly DepositCandidate[];
  /** ISO day, so the card agrees with the rest of the trip about what "today"
   *  is — the trip's own time zone, same as the plan screen's `todayIn`. */
  today: string;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const payments = upcomingPayments(expenses, today);
  if (payments.length === 0) return null;
  const overdue = overdueCount(payments);

  return (
    <Card style={{ gap: theme.spacing.sm }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="subheading">{t.eventOrganizer.upcomingPaymentsTitle}</Text>
        {overdue > 0 ? (
          <Badge label={plural(locale, overdue, t.eventOrganizer.overdueCount)} tone="negative" />
        ) : null}
      </Row>
      <View style={{ gap: theme.spacing.sm }}>
        {payments.slice(0, MAX_ROWS).map((payment) => (
          <Pressable
            key={payment.expenseId}
            onPress={() => router.push(`/group/${groupId}/expense/${payment.expenseId}`)}
            accessibilityRole="button"
            accessibilityLabel={payment.description}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Text variant="caption" numberOfLines={1} style={{ flex: 1 }}>
                {payment.description}
              </Text>
              <Row style={{ gap: theme.spacing.xs, alignItems: 'center' }}>
                <MoneyText
                  amount={payment.balanceDueMinor}
                  currency={payment.currency}
                  locale={locale}
                  variant="caption"
                  mode="plain"
                />
                <Text variant="micro" tone={payment.overdue ? 'negative' : 'muted'}>
                  {payment.balanceDueDate
                    ? showDate(payment.balanceDueDate, locale)
                    : t.eventOrganizer.dueWhenever}
                </Text>
              </Row>
            </Row>
          </Pressable>
        ))}
      </View>
    </Card>
  );
}
