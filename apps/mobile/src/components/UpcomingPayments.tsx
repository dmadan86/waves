/**
 * "Upcoming payments" (docs/event-organizer.md): the vendor balances still
 * OWED on this group, soonest/overdue first. Built from the same data as the
 * Vendors tab (`lib/eventVendors`), so the two cannot disagree; an advance
 * that is already paid never shows here. All the maths lives in the lib; this
 * only draws it.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { Badge, Card, iconSize, MoneyText, Row, Text, useTheme } from '@waves/ui';
import { Pressable, View } from 'react-native';

import { showDate } from '@/lib/expenseDay';
import { upcomingVendorPayments, type VendorCandidate } from '@/lib/eventVendors';
import { router } from '@/lib/navigation';
import { fill, plural, useStrings } from '@/i18n';

/** How many rows the compact card shows before "View all" takes over. */
const MAX_ROWS = 3;

export function UpcomingPayments({
  groupId,
  candidates,
  today,
  subEventLabel,
  showEmpty = false,
  onViewAll,
}: {
  groupId: string;
  candidates: readonly VendorCandidate[];
  /** ISO day in the group's own time zone. */
  today: string;
  /** "emoji Label" for a sub-event id, or '' when it is unknown. */
  subEventLabel: (id: string) => string;
  /** Show "Nothing due" instead of hiding the card when there is nothing owed. */
  showEmpty?: boolean;
  /** Opens the Vendors tab filtered to Due; omitted where there is no such tab. */
  onViewAll?: () => void;
}) {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const o = t.eventOrganizer;
  const payments = upcomingVendorPayments(candidates, today);
  if (payments.length === 0 && !showEmpty) return null;
  const overdue = payments.filter((p) => p.overdue).length;

  return (
    <Card style={{ gap: theme.spacing.sm, paddingVertical: theme.spacing.md }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text variant="subheading" accessibilityRole="header">
            {o.upcomingPaymentsTitle}
          </Text>
          {payments.length === 0 ? (
            <Text variant="micro" tone="muted">
              {o.nothingDue}
            </Text>
          ) : null}
        </View>
        <Row style={{ gap: theme.spacing.sm, alignItems: 'center' }}>
          {overdue > 0 ? (
            <Badge label={plural(locale, overdue, o.overdueCount)} tone="negative" />
          ) : null}
          {onViewAll && payments.length > 0 ? (
            <Pressable
              onPress={onViewAll}
              accessibilityRole="button"
              accessibilityLabel={o.viewAll}
              hitSlop={8}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 2,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text variant="caption" tone="brand">
                {o.viewAll}
              </Text>
              <Ionicons name="chevron-forward" size={iconSize.sm} color={theme.color.brand} />
            </Pressable>
          ) : null}
        </Row>
      </Row>
      {payments.slice(0, MAX_ROWS).map((payment) => {
        const sub = payment.subEventId ? subEventLabel(payment.subEventId) : '';
        const due = payment.dueDate
          ? fill(o.dueOn, { date: showDate(payment.dueDate, locale) })
          : o.dueWhenever;
        return (
          <Pressable
            key={payment.expenseId}
            onPress={() => router.push(`/group/${groupId}/expense/${payment.expenseId}`)}
            accessibilityRole="button"
            accessibilityLabel={`${payment.vendorName || o.unnamedVendor},${sub ? `${sub}, ` : ''}${due}`}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text variant="caption" numberOfLines={1}>
                  {payment.vendorName || o.unnamedVendor}
                </Text>
                {sub ? (
                  <Text variant="micro" tone="muted" numberOfLines={1}>
                    {sub}
                  </Text>
                ) : null}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <MoneyText
                  amount={payment.balanceMinor}
                  currency={payment.currency}
                  locale={locale}
                  variant="caption"
                  mode="plain"
                />
                <Text
                  variant="micro"
                  tone={payment.overdue ? 'negative' : 'muted'}
                  style={
                    payment.dueSoon && !payment.overdue
                      ? { color: theme.color.warning, fontWeight: '600' }
                      : undefined
                  }
                >
                  {due}
                </Text>
              </View>
            </Row>
          </Pressable>
        );
      })}
    </Card>
  );
}
