/**
 * The dashboard's Upcoming list: the recurring bills and income coming up next,
 * soonest first, from the personal ledger's recurring rules.
 *
 * That ledger is private and sits behind its own lock, so the list is only
 * drawn while the section is open (`usePersonalPeek`). Shut, it says so and
 * offers the unlock on a button rather than raising the prompt by itself — the
 * ledger is never read, let alone shown, until then: the list is a separate
 * component that only mounts once the lock is open.
 */

import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { format, frequencyOf, money } from '@waves/core';
import { Button, EmptyState, iconSize, Row, Text, useTheme } from '@waves/ui';

import { useSourceLabel } from '@/components/IncomeSource';
import { todayIso, usePersonalLedger } from '@/data/personal';
import { useStrings } from '@/i18n';
import { frequencyLabel } from '@/lib/frequencyLabel';
import { daysBetween, upcomingRules } from '@/lib/homeDashboard';
import { usePersonalPeek } from '@/lib/lock';
import { router } from '@/lib/navigation';

/** How many upcoming occurrences the dashboard lists. */
const PREVIEW = 6;

export function HomeUpcoming() {
  const theme = useTheme();
  const { t } = useStrings();
  const { unlocked, unlock } = usePersonalPeek(t.lock.personalPrompt);

  if (!unlocked) {
    return (
      <View
        style={{
          alignItems: 'center',
          gap: theme.spacing.md,
          padding: theme.spacing.xl,
          backgroundColor: theme.color.surface,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: theme.color.border,
        }}
      >
        <Ionicons name="lock-closed-outline" size={iconSize.xxl} color={theme.color.brand} />
        <Text variant="body" tone="muted" align="center">
          {t.homeDash.upcomingLocked}
        </Text>
        <Button label={t.homeDash.unlock} onPress={() => void unlock()} />
      </View>
    );
  }
  return <UpcomingList />;
}

function UpcomingList() {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const { recurrings } = usePersonalLedger();
  const sourceLabel = useSourceLabel();
  const [today] = useState(() => todayIso());
  const [rtf] = useState(() =>
    typeof Intl.RelativeTimeFormat === 'function'
      ? new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
      : undefined,
  );
  const rules = upcomingRules(recurrings).slice(0, PREVIEW);

  const manage = (
    <Button
      label={t.homeDash.manageRecurring}
      variant="ghost"
      onPress={() => router.push('/personal/recurring')}
    />
  );

  if (rules.length === 0) {
    return <EmptyState title={t.homeDash.upcomingEmpty} action={manage} />;
  }

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View
        style={{
          backgroundColor: theme.color.surface,
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: theme.color.border,
          paddingHorizontal: theme.spacing.md,
        }}
      >
        {rules.map((rule, index) => {
          const income = rule.txnKind === 'income';
          const tint = income ? theme.tint.mint : theme.tint.peach;
          const title =
            rule.note?.trim() ||
            sourceLabel(rule.category) ||
            (income ? t.personal.incomeKind : t.personal.expense);
          const when = rtf ? rtf.format(daysBetween(today, rule.nextDate), 'day') : rule.nextDate;
          const cadence = frequencyLabel(t, frequencyOf(rule), rule.interval);
          const amount = format(money(rule.amount, rule.currency), { locale });
          return (
            <Pressable
              key={rule.id}
              accessibilityRole="button"
              accessibilityLabel={`${title}, ${amount}, ${when}`}
              onPress={() => router.push(`/personal/source/${rule.id}`)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.spacing.md,
                paddingVertical: theme.spacing.md,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: theme.color.border,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: theme.radius.md,
                  backgroundColor: tint.bg,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="repeat" size={iconSize.lg} color={tint.ink} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="body" numberOfLines={1} style={{ fontWeight: '600' }}>
                  {title}
                </Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {`${when} · ${cadence}`}
                </Text>
              </View>
              <Row>
                <Text
                  variant="body"
                  style={{
                    fontWeight: '700',
                    color: income ? theme.color.positive : theme.color.text,
                  }}
                >
                  {`${income ? '+' : '−'}${amount}`}
                </Text>
              </Row>
            </Pressable>
          );
        })}
      </View>
      {manage}
    </View>
  );
}
