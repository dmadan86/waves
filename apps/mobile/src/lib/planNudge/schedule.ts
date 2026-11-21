/**
 * The half that talks to the OS: local date-trigger alarms (inexact, so no
 * Android 14 exact-alarm permission), read back from the OS list, which is the
 * source of truth. Nothing here throws. See `captureNudge/schedule.ts`.
 */

import * as Notifications from 'expo-notifications';

import { ensureAndroidChannel, pushSupported } from '@/lib/push';

/** Stamped into every notification of ours, so a sweep never touches anybody else's. */
export const PLAN_KEY = 'waves.plan.nudge';

async function ourRequests(): Promise<Notifications.NotificationRequest[]> {
  if (!pushSupported) return [];
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    return all.filter((r) => (r.content.data as { key?: unknown } | undefined)?.key === PLAN_KEY);
  } catch {
    return [];
  }
}

/** The `id`s of the plan notifications the OS is holding. */
export async function pendingPlanIds(): Promise<string[]> {
  return (await ourRequests()).map((r) => String((r.content.data as { id?: unknown }).id ?? ''));
}

export async function cancelPlanNudges(): Promise<void> {
  for (const request of await ourRequests()) {
    try {
      await Notifications.cancelScheduledNotificationAsync(request.identifier);
    } catch {
      // One that will not cancel may still fire; stopping would strand the rest.
    }
  }
}

export interface ScheduledPlan {
  readonly id: string;
  readonly fireAt: number;
  readonly url: string;
  readonly ownerId: string;
  readonly title: string;
  readonly body: string;
}

/** Schedules each; returns the fire times that really were set. */
export async function schedulePlanNudges(items: readonly ScheduledPlan[]): Promise<number[]> {
  if (!pushSupported || items.length === 0) return [];
  const set: number[] = [];
  try {
    await ensureAndroidChannel();
  } catch {
    return set;
  }
  for (const item of items) {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: item.title,
          body: item.body,
          data: {
            key: PLAN_KEY,
            id: item.id,
            url: item.url,
            fireAt: item.fireAt,
            ownerId: item.ownerId,
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(item.fireAt),
          channelId: 'default',
        },
      });
      set.push(item.fireAt);
    } catch {
      // A refused alarm is a reminder that does not happen, not a crash.
    }
  }
  return set;
}
