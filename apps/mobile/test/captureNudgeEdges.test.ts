/**
 * The capture reminder's edges: the stored switch and marks, and the OS half on
 * a platform — or a device — that will not cooperate.
 *
 * The planner and the happy scheduling path are covered in `captureNudge` and
 * `captureNudgeSchedule`. What this pins is the rule both headers state: every
 * function here swallows its own failures and reports a value. A reminder that
 * could not be set is a reminder that does not happen, never a crash in a
 * headless component nobody is looking at — and a store that cannot be read is
 * never taken as "they switched it off".
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NudgeAction, NudgeKind } from '@/lib/captureNudge/plan';
import {
  cancelNudges,
  dismissDeliveredNudges,
  pendingNudge,
  scheduleNudge,
  setNudgeBadge,
} from '@/lib/captureNudge/schedule';
import {
  clearCaptureNudge,
  loadCaptureNudgeEnabled,
  loadLastSeen,
  loadPlannedNudge,
  saveCaptureNudgeEnabled,
  saveLastSeen,
  savePlannedNudge,
} from '@/lib/captureNudge/settings';
import { syncCaptureNudge } from '@/lib/captureNudge/run';

const h = vi.hoisted(() => ({
  pushSupported: true,
  fail: new Set<string>(),
  requests: [] as unknown[],
  presented: [] as unknown[],
  cancelled: [] as string[],
  dismissed: [] as string[],
  scheduled: [] as unknown[],
}));

vi.mock('@/lib/push', () => ({
  ensureAndroidChannel: vi.fn(),
  localNotificationsAllowed: async () => true,
  get pushSupported() {
    return h.pushSupported;
  },
}));

function maybeFail(name: string): void {
  if (h.fail.has(name)) throw new Error(`${name} refused`);
}

vi.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date' },
  getAllScheduledNotificationsAsync: async () => {
    maybeFail('list');
    return h.requests;
  },
  cancelScheduledNotificationAsync: async (id: string) => {
    maybeFail('cancel');
    h.cancelled.push(id);
  },
  scheduleNotificationAsync: async (input: unknown) => {
    maybeFail('schedule');
    h.scheduled.push(input);
    return 'id';
  },
  setBadgeCountAsync: async () => {
    maybeFail('badge');
    return true;
  },
  getPresentedNotificationsAsync: async () => {
    maybeFail('presented');
    return h.presented;
  },
  dismissNotificationAsync: async (id: string) => void h.dismissed.push(id),
}));

const KEY = 'waves.captures.nudge';
const ours = (id: string, data: Record<string, unknown> = {}) => ({
  identifier: id,
  content: { data: { key: KEY, ...data } },
});
const TEXT = { title: 'T', body: 'B' };

beforeEach(async () => {
  h.pushSupported = true;
  h.fail.clear();
  h.requests = [];
  h.presented = [];
  h.cancelled = [];
  h.dismissed = [];
  h.scheduled = [];
  await AsyncStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('settings', () => {
  it('defaults the switch on, and remembers an explicit choice per account', async () => {
    expect(await loadCaptureNudgeEnabled('a')).toBe(true);
    await saveCaptureNudgeEnabled('a', false);
    expect(await loadCaptureNudgeEnabled('a')).toBe(false);
    expect(await loadCaptureNudgeEnabled('b')).toBe(true);
    await saveCaptureNudgeEnabled('a', true);
    expect(await loadCaptureNudgeEnabled('a')).toBe(true);
  });

  it('answers a signed-out caller with nothing, and writes nothing for one', async () => {
    expect(await loadCaptureNudgeEnabled('')).toBe(false);
    expect(await loadPlannedNudge('')).toBeNull();
    expect(await loadLastSeen('')).toBeNull();
    await saveCaptureNudgeEnabled('', true);
    await savePlannedNudge('', 5);
    await saveLastSeen('', 5);
    await clearCaptureNudge('');
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });

  it('reads an unreadable store as the default, not as "switched off"', async () => {
    vi.spyOn(AsyncStorage, 'getItem').mockRejectedValue(new Error('locked'));
    expect(await loadCaptureNudgeEnabled('a')).toBe(true);
    expect(await loadPlannedNudge('a')).toBeNull();
    expect(await loadLastSeen('a')).toBeNull();
  });

  it('stores and clears the planned fire time, and reads garbage as none', async () => {
    await savePlannedNudge('a', 1_800_000_000_000);
    expect(await loadPlannedNudge('a')).toBe(1_800_000_000_000);
    await savePlannedNudge('a', null);
    expect(await loadPlannedNudge('a')).toBeNull();
    await AsyncStorage.setItem('waves.capture_nudge.planned_at.a', 'soon');
    expect(await loadPlannedNudge('a')).toBeNull();
  });

  it('stores when the app was last seen, and reads garbage as never', async () => {
    await saveLastSeen('a', 1234);
    expect(await loadLastSeen('a')).toBe(1234);
    await AsyncStorage.setItem('waves.capture_nudge.last_seen_at.a', '-1');
    expect(await loadLastSeen('a')).toBeNull();
  });

  it('shrugs off a failed last-seen write', async () => {
    vi.spyOn(AsyncStorage, 'setItem').mockRejectedValue(new Error('full'));
    await expect(saveLastSeen('a', 1)).resolves.toBeUndefined();
  });

  it('wipes every key of the departing account and none of anybody else', async () => {
    await saveCaptureNudgeEnabled('a', false);
    await savePlannedNudge('a', 10);
    await saveLastSeen('a', 10);
    await saveLastSeen('b', 10);
    vi.spyOn(AsyncStorage, 'removeItem').mockImplementationOnce(async () => {
      throw new Error('one refused');
    });
    await clearCaptureNudge('a');
    const keys = await AsyncStorage.getAllKeys();
    expect(keys.filter((key) => key.endsWith('.a')).length).toBeLessThanOrEqual(1);
    expect(keys).toContain('waves.capture_nudge.last_seen_at.b');
  });
});

describe('the OS half, where push is not supported (web)', () => {
  beforeEach(() => {
    h.pushSupported = false;
  });

  it('reports nothing pending and schedules nothing', async () => {
    h.requests = [ours('x')];
    expect(await pendingNudge()).toBeNull();
    expect(
      await scheduleNudge({
        fireAt: 1,
        count: 1,
        locale: 'en',
        kind: NudgeKind.Captures,
        text: TEXT,
      }),
    ).toBe(false);
    await setNudgeBadge(3);
    await dismissDeliveredNudges();
    await cancelNudges();
    expect(h.scheduled).toEqual([]);
    expect(h.cancelled).toEqual([]);
  });
});

describe('the OS half, on a device that refuses', () => {
  it('treats an unreadable schedule as empty', async () => {
    h.fail.add('list');
    expect(await pendingNudge()).toBeNull();
  });

  it('reports a pending reminder it cannot read as one to replace', async () => {
    h.requests = [ours('x', { fireAt: 'soon', count: 2, locale: 'ta' })];
    expect(await pendingNudge()).toEqual({
      fireAt: 0,
      count: -1,
      locale: 'ta',
      kind: NudgeKind.Captures,
    });
  });

  it('reads a check-in back as a check-in, and a missing locale as none', async () => {
    h.requests = [ours('x', { fireAt: 100, count: 0, kind: NudgeKind.CheckIn })];
    expect(await pendingNudge()).toEqual({
      fireAt: 100,
      count: 0,
      locale: '',
      kind: NudgeKind.CheckIn,
    });
  });

  it('keeps cancelling past one that will not cancel', async () => {
    h.requests = [ours('a'), ours('b')];
    h.fail.add('cancel');
    await expect(cancelNudges()).resolves.toBeUndefined();
  });

  it('never lets a refused badge or shade fail the pass', async () => {
    h.fail.add('badge');
    h.fail.add('presented');
    await expect(setNudgeBadge(-4)).resolves.toBeUndefined();
    await expect(dismissDeliveredNudges()).resolves.toBeUndefined();
  });

  it('dismisses only our delivered reminders', async () => {
    h.presented = [
      { request: ours('mine') },
      { request: { identifier: 'invite', content: { data: { key: 'waves.invite' } } } },
      { request: { identifier: 'bare', content: { data: null } } },
    ];
    await dismissDeliveredNudges();
    expect(h.dismissed).toEqual(['mine']);
  });

  it('says a refused alarm was not set', async () => {
    h.fail.add('schedule');
    expect(
      await scheduleNudge({
        fireAt: 1,
        count: 1,
        locale: 'en',
        kind: NudgeKind.Captures,
        text: TEXT,
      }),
    ).toBe(false);
  });
});

describe('a pass with nobody signed in', () => {
  it('keeps whatever is there and reads nothing', async () => {
    const plan = await syncCaptureNudge({
      ownerId: '',
      waitingCount: 3,
      oldestWaitingAt: 0,
      locale: 'en',
      now: 0,
      hasGroup: true,
      text: () => TEXT,
    });
    expect(plan).toEqual({ action: NudgeAction.Keep });
    expect(h.scheduled).toEqual([]);
  });
});
