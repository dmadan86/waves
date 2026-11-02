/**
 * Local 09:00 alarms for follow-ups assigned to this member. The phone sets them on itself (no server, no push);
 * they are re-planned whenever the follow-up list changes, so create, move, done and delete all converge.
 * Never prompts for permission and never throws: no permission or no module just means no reminder.
 */
import * as Notifications from 'expo-notifications';

import { planReminders, type HeldReminder, type ReminderTask } from '@/lib/followUpPlan';
import { ensureAndroidChannel, pushSupported } from '@/lib/push';

const KEY = 'waves.followup';

let chain: Promise<void> = Promise.resolve();

/** Serialised, so two screens syncing at once cannot double-schedule. */
export function syncFollowUpReminders(input: Input): Promise<void> {
  chain = chain.then(() => run(input));
  return chain;
}

interface Input {
  groupId: string;
  myId: string | null;
  tasks: readonly (ReminderTask & { title: string })[];
  title: string;
}

async function run(input: Input): Promise<void> {
  if (!pushSupported) return;
  try {
    if ((await Notifications.getPermissionsAsync()).status !== 'granted') return;
    const held: HeldReminder[] = (await Notifications.getAllScheduledNotificationsAsync()).flatMap(
      (r) => {
        const d = r.content.data as {
          key?: string;
          groupId?: string;
          taskId?: string;
          fireAt?: number;
        };
        return d?.key === KEY && d.groupId === input.groupId && d.taskId
          ? [{ identifier: r.identifier, taskId: d.taskId, fireAt: Number(d.fireAt) }]
          : [];
      },
    );
    const plan = planReminders(input.tasks, input.myId, held, new Date());
    for (const id of plan.cancel) await Notifications.cancelScheduledNotificationAsync(id);
    if (plan.add.length) await ensureAndroidChannel();
    for (const { task, at } of plan.add) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: input.title,
          body: task.title,
          data: {
            key: KEY,
            groupId: input.groupId,
            taskId: task.id,
            fireAt: at.getTime(),
            url: `waves://group/${input.groupId}/company-followups`,
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: at,
          channelId: 'default',
        },
      });
    }
  } catch {
    // A reminder that could not be set is a reminder that does not happen, never a crash.
  }
}
