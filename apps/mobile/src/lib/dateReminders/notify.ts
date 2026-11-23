/** One local notification for the next date reminder, at 10:00 (captureNudge's shape). */

import * as Notifications from 'expo-notifications';

import { ensureAndroidChannel, localNotificationsAllowed, pushSupported } from '@/lib/push';

const KEY = 'waves.dates.reminder';

async function ours(): Promise<Notifications.NotificationRequest[]> {
  if (!pushSupported) return [];
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    return all.filter((r) => (r.content.data as { key?: unknown } | undefined)?.key === KEY);
  } catch {
    return [];
  }
}

/** Replace whatever is held with `plan`, or just clear it when `plan` is null. Never asks permission. */
export async function syncDateNotification(
  plan: { fireAt: number; itemKey: string; title: string; body: string } | null,
): Promise<void> {
  if (!pushSupported) return;
  const held = await ours();
  const same =
    plan !== null &&
    held.length === 1 &&
    (held[0]!.content.data as { itemKey?: unknown }).itemKey === plan.itemKey &&
    (held[0]!.content.data as { body?: unknown }).body === plan.body;
  if (same) return;
  for (const r of held) {
    await Notifications.cancelScheduledNotificationAsync(r.identifier).catch(() => {});
  }
  if (!plan || !(await localNotificationsAllowed())) return;
  try {
    await ensureAndroidChannel();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: plan.title,
        body: plan.body,
        data: { key: KEY, itemKey: plan.itemKey, body: plan.body, url: 'waves://dates' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(plan.fireAt),
        channelId: 'default',
      },
    });
  } catch {
    // Nothing to do: the card on Home still says it.
  }
}
