/**
 * "From Waves" (C4): the next date reminder as a friendly chat message with
 * one-tap replies. Inline on Home, never a pop-up; it takes a low-priority slot
 * in the prompt queue, so it stays quiet during voice and behind real prompts.
 * It also runs the 10:00 local-notification pass.
 */

import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { Row, Text, useTheme } from '@waves/ui';

import { useDateOccurrences } from '@/data/personalDates';
import { useStrings } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { actionFor } from '@/lib/dateReminders/actions';
import { syncDateNotification } from '@/lib/dateReminders/notify';
import { leadDays, pickReminderCard, planDateNotification } from '@/lib/dateReminders/plan';
import { dismissOccurrence, useDatePrefs } from '@/lib/dateReminders/store';
import { actionLabel, askOf, headlineOf } from '@/lib/dateReminders/text';
import { useRunDateAction } from '@/lib/dateReminders/useRunDateAction';
import { reportHandled } from '@/lib/observability';
import { usePromptSlot } from '@/lib/promptQueue';

export function DateReminderCard() {
  const { t, locale } = useStrings();
  const theme = useTheme();
  const { session, isGuest } = useAuth();
  const occurrences = useDateOccurrences();
  const { dismissed, owner } = useDatePrefs();
  const run = useRunDateAction();
  const signedIn = !!session && !isGuest && owner !== '';

  const card = signedIn ? pickReminderCard(occurrences, new Set(dismissed)) : null;
  const shown = usePromptSlot({ id: 'date-reminder', priority: 5, active: card !== null });

  useEffect(() => {
    if (!signedIn) return;
    const plan = planDateNotification(occurrences, new Set(dismissed), Date.now());
    // Worded as it will read on the day it fires, not as it reads today.
    const at = plan ? { ...plan.item, inDays: leadDays(plan.item) } : null;
    void syncDateNotification(
      plan && at
        ? {
            fireAt: plan.fireAt,
            itemKey: plan.item.key,
            title: t.dates.notifTitle,
            body: `${headlineOf(at, t.dates, locale)} ${askOf(at, t.dates)}`,
          }
        : null,
    ).catch((e: unknown) => reportHandled(e, 'dateReminders.sync'));
  }, [signedIn, occurrences, dismissed, t, locale]);

  if (!card || !shown) return null;
  const action = actionFor(card);
  const answer = (go: boolean): void => {
    dismissOccurrence(card.key);
    if (go) run(card);
  };
  const chip = (label: string, primary: boolean, onPress: () => void) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        height: 34,
        paddingHorizontal: theme.spacing.lg,
        borderRadius: theme.radius.pill,
        borderWidth: 1.5,
        borderColor: primary ? theme.color.brand : theme.color.border,
        backgroundColor: primary ? theme.color.brandSoft : theme.color.surface,
        justifyContent: 'center',
      }}
    >
      <Text variant="caption" tone={primary ? 'brand' : undefined} style={{ fontWeight: '700' }}>
        {label}
      </Text>
    </Pressable>
  );
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Row style={{ alignItems: 'center', gap: theme.spacing.sm }}>
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: theme.color.brand,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: theme.color.onBrand, fontSize: 12, fontWeight: '800' }}>W</Text>
        </View>
        <Text variant="caption" tone="muted">
          {t.dates.reminder.from}
        </Text>
      </Row>
      <View
        style={{
          alignSelf: 'flex-start',
          maxWidth: '88%',
          backgroundColor: theme.color.surface,
          borderRadius: theme.radius.lg,
          borderWidth: theme.scheme === 'dark' ? 0 : 1,
          borderColor: theme.color.border,
          paddingHorizontal: theme.spacing.md + 2,
          paddingVertical: theme.spacing.md,
        }}
      >
        <Text>{`${headlineOf(card, t.dates, locale)} ${askOf(card, t.dates)}`}</Text>
      </View>
      <Row style={{ gap: theme.spacing.sm, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {action ? chip(actionLabel(action, t.dates), true, () => answer(true)) : null}
        {chip(t.dates.reminder.notThisTime, false, () => answer(false))}
      </Row>
    </View>
  );
}
