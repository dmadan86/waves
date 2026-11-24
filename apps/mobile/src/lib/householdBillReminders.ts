/**
 * Local alarms for shared bills the viewer pays (3 days before, and on the day,
 * 10:00). Same shape as `followUpReminders`: no server, no permission prompt,
 * never throws; a missing permission just means no reminder.
 */
import * as Notifications from 'expo-notifications';

import { planBillReminders, type HeldBillReminder, type PayerBill } from '@/lib/householdBills';
import { ensureAndroidChannel, pushSupported } from '@/lib/push';

const KEY = 'waves.householdbill';

let chain: Promise<void> = Promise.resolve();

export interface BillReminderCopy {
  readonly title: (bill: PayerBill, kind: 'ahead' | 'today') => string;
  readonly body: (bill: PayerBill) => string;
}

/** Serialised, re-run whenever the bills change, so create/edit/stop all converge. */
export function syncBillReminders(
  bills: readonly PayerBill[],
  copy: BillReminderCopy,
): Promise<void> {
  chain = chain.then(() => run(bills, copy));
  return chain;
}

async function run(bills: readonly PayerBill[], copy: BillReminderCopy): Promise<void> {
  if (!pushSupported) return;
  try {
    if ((await Notifications.getPermissionsAsync()).status !== 'granted') return;
    const held: HeldBillReminder[] = (
      await Notifications.getAllScheduledNotificationsAsync()
    ).flatMap((r) => {
      const d = r.content.data as { key?: string; reminderKey?: string; fireAt?: number };
      return d?.key === KEY && d.reminderKey
        ? [{ identifier: r.identifier, key: d.reminderKey, fireAt: Number(d.fireAt) }]
        : [];
    });
    const plan = planBillReminders(bills, held, new Date());
    for (const id of plan.cancel) await Notifications.cancelScheduledNotificationAsync(id);
    if (plan.add.length) await ensureAndroidChannel();
    for (const r of plan.add) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: copy.title(r.bill, r.kind),
          body: copy.body(r.bill),
          data: {
            key: KEY,
            reminderKey: r.key,
            fireAt: r.at.getTime(),
            url: `waves://group/${r.bill.groupId}`,
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: r.at,
          channelId: 'default',
        },
      });
    }
  } catch {
    // A reminder that could not be set is a reminder that does not happen, never a crash.
  }
}

/** Sign-out: drop every bill alarm of ours (they name the household's bills). */
export function cancelBillReminders(): Promise<void> {
  chain = chain.then(async () => {
    if (!pushSupported) return;
    try {
      for (const r of await Notifications.getAllScheduledNotificationsAsync())
        if ((r.content.data as { key?: string } | undefined)?.key === KEY)
          await Notifications.cancelScheduledNotificationAsync(r.identifier);
    } catch {
      // The next sign-in's sync reconciles.
    }
  });
  return chain;
}
