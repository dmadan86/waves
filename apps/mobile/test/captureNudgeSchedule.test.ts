import { syncCaptureNudge } from '@/lib/captureNudge/run';
import { cancelNudges, scheduleNudge } from '@/lib/captureNudge/schedule';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const notifications = vi.hoisted(() => ({
  requests: [] as { identifier: string; content: { data?: Record<string, unknown> } }[],
  cancelled: [] as string[],
  badgeCounts: [] as number[],
  scheduled: [] as unknown[],
  /** What is already in the notification shade, delivered. */
  presented: [] as {
    request: { identifier: string; content: { data?: Record<string, unknown> } };
  }[],
  dismissed: [] as string[],
}));

vi.mock('@/lib/push', () => ({
  ensureAndroidChannel: vi.fn(),
  localNotificationsAllowed: async () => true,
  pushSupported: true,
}));

vi.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date' },
  getAllScheduledNotificationsAsync: async () => notifications.requests,
  cancelScheduledNotificationAsync: async (identifier: string) => {
    notifications.cancelled.push(identifier);
  },
  scheduleNotificationAsync: async (input: unknown) => {
    notifications.scheduled.push(input);
    return 'scheduled-id';
  },
  setBadgeCountAsync: async (count: number) => {
    notifications.badgeCounts.push(count);
    return true;
  },
  getPresentedNotificationsAsync: async () => notifications.presented,
  dismissNotificationAsync: async (identifier: string) => {
    notifications.dismissed.push(identifier);
  },
}));

const OUR_NUDGE = { identifier: 'ours', content: { data: { key: 'waves.captures.nudge' } } };
const OTHER_NUDGE = { identifier: 'theirs', content: { data: { key: 'waves.other' } } };

describe('capture nudge scheduler', () => {
  beforeEach(() => {
    notifications.requests = [];
    notifications.cancelled = [];
    notifications.badgeCounts = [];
    notifications.scheduled = [];
    notifications.presented = [];
    notifications.dismissed = [];
  });

  it('clears the app badge when cancelling the waiting-captures reminder', async () => {
    notifications.requests = [OUR_NUDGE, OTHER_NUDGE];

    await cancelNudges();

    expect(notifications.cancelled).toEqual(['ours']);
    expect(notifications.badgeCounts).toEqual([0]);
  });

  it('clears a fired reminder badge even when no scheduled request remains', async () => {
    await syncCaptureNudge({
      ownerId: 'user',
      waitingCount: 0,
      oldestWaitingAt: null,
      locale: 'en',
      now: 1_800_000_000_000,
      text: (count) => ({ title: 'Waiting on you', body: `${count} expenses are waiting.` }),
    });

    expect(notifications.cancelled).toEqual([]);
    expect(notifications.badgeCounts).toEqual([0]);
  });

  /**
   * A reminder's own badge is the count as it was when the reminder was set,
   * and many Android launchers ignore it anyway and show how many of our
   * notifications are in the shade instead. Two unread reminders read as "2" on
   * an inbox holding a hundred and twenty-nine drafts — not a number rendered
   * badly, a different fact. So a pass writes the live count itself.
   */
  it('puts the live waiting count on the icon, not the count some reminder was set with', async () => {
    await syncCaptureNudge({
      ownerId: 'user',
      waitingCount: 129,
      oldestWaitingAt: 1_799_000_000_000,
      locale: 'en',
      now: 1_800_000_000_000,
      text: (count) => ({ title: 'Waiting on you', body: `${count} expenses are waiting.` }),
    });

    // The last word, not the only one: replacing the reminder cancels the old
    // one first and a cancel takes the badge down, so a 0 passes through on the
    // way. What matters is where it lands.
    expect(notifications.badgeCounts.at(-1)).toBe(129);
  });

  /**
   * Yesterday's card, left unread, is a stale count on a lock screen — and on a
   * launcher that badges by notification count, the pile of them *is* the
   * number on the icon. Ours only: a settle-up push must not be swept away
   * from under somebody.
   */
  it('leaves one reminder in the shade, and never touches another notification', async () => {
    notifications.presented = [
      { request: { identifier: 'old-nudge', content: { data: { key: 'waves.captures.nudge' } } } },
      { request: { identifier: 'a-settle-up', content: { data: { key: 'waves.settlement' } } } },
    ];

    await syncCaptureNudge({
      ownerId: 'user',
      waitingCount: 129,
      oldestWaitingAt: 1_799_000_000_000,
      locale: 'en',
      now: 1_800_000_000_000,
      text: (count) => ({ title: 'Waiting on you', body: `${count} expenses are waiting.` }),
    });

    expect(notifications.dismissed).toEqual(['old-nudge']);
  });

  it('writes the waiting count onto the scheduled reminder badge', async () => {
    await scheduleNudge({
      fireAt: 1_800_000_000_000,
      count: 4,
      locale: 'en',
      text: { title: 'Waiting on you', body: '4 expenses are waiting.' },
    });

    expect(notifications.scheduled).toHaveLength(1);
    expect(notifications.scheduled[0]).toMatchObject({ content: { badge: 4 } });
  });
});
