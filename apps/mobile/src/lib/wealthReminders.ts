/** Holds the local reminders for SIPs, rent, lease ends and maturities (10:00). Never asks permission. */

import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';

import { format, money } from '@waves/core';

import { usePersonalLedger, todayIso } from '@/data/personal';
import { usePersonalWealth } from '@/data/personalWealth';
import { fill, useStrings } from '@/i18n';
import type { WealthStrings } from '@/i18n/wealth';
import { ensureAndroidChannel, localNotificationsAllowed, pushSupported } from '@/lib/push';
import { planWealthReminders, type WealthReminder } from '@/lib/wealthPlan';

const KEY = 'waves.wealth.reminder';

export function reminderBody(r: WealthReminder, w: WealthStrings, amount: string): string {
  switch (r.kind) {
    case 'sipTomorrow':
      return fill(w.sipTomorrow, { name: r.name, amount });
    case 'sipToday':
      return fill(w.sipToday, { name: r.name, amount });
    case 'rentDue':
      return fill(w.rentDueToday, { name: r.name, amount });
    case 'rentLate':
      return fill(w.rentNotRecorded, { name: r.name, amount });
    case 'leaseEnd':
      return fill(w.leaseEndNote, { name: r.name, n: r.days });
    default:
      return fill(w.maturityNote, { name: r.name, n: r.days });
  }
}

async function replaceAll(items: { r: WealthReminder; title: string; body: string }[]): Promise<void> {
  if (!pushSupported) return;
  try {
    const held = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of held) {
      if ((n.content.data as { key?: unknown } | undefined)?.key === KEY) {
        await Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {});
      }
    }
    if (items.length === 0 || !(await localNotificationsAllowed())) return;
    await ensureAndroidChannel();
    for (const { r, title, body } of items) {
      await Notifications.scheduleNotificationAsync({
        content: { title, body, data: { key: KEY, url: r.url } },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(r.fireAt),
          channelId: 'default',
        },
      });
    }
  } catch {
    // The Upcoming list still says it.
  }
}

/** Re-plans the reminders whenever the records change. Mount once on the Personal home. */
export function useWealthReminders(currency: string): void {
  const { t } = useStrings();
  const ledger = usePersonalLedger();
  const wealth = usePersonalWealth();
  useEffect(() => {
    const today = todayIso();
    const plan = planWealthReminders({
      investments: wealth.investments,
      properties: wealth.properties,
      tenancies: wealth.tenancies,
      recurrings: ledger.recurrings,
      txns: ledger.txns,
      today,
      now: Date.now(),
    });
    const w = t.wealth;
    void replaceAll(
      plan.map((r) => ({
        r,
        title: r.kind === 'sipTomorrow' || r.kind === 'sipToday' || r.kind === 'maturity' ? w.investments : w.rentals,
        body: reminderBody(r, w, format(money(r.amount, currency))),
      })),
    );
  }, [wealth, ledger.recurrings, ledger.txns, t, currency]);
}
