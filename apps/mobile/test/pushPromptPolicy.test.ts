import { describe, expect, it } from 'vitest';

import {
  EARLY_GAP_MS,
  JOIN_GAP_MS,
  LATE_GAP_MS,
  parsePushPromptState,
  pushCtaAction,
  shouldShowPushPrompt,
} from '@/lib/pushPromptPolicy';

const NOW = 1_800_000_000_000;
const denied = 'denied' as const;
const state = (agoMs: number | null, dismissCount: number) => ({
  lastShownAt: agoMs === null ? null : NOW - agoMs,
  dismissCount,
});
const show = (agoMs: number | null, dismissCount: number, extra = {}) =>
  shouldShowPushPrompt({
    now: NOW,
    state: state(agoMs, dismissCount),
    permission: denied,
    ...extra,
  });

describe('shouldShowPushPrompt', () => {
  it('never shows once permission is granted', () => {
    expect(shouldShowPushPrompt({ now: NOW, state: state(null, 0), permission: 'granted' })).toBe(
      false,
    );
  });

  it('shows when it has never been shown', () => {
    expect(show(null, 0)).toBe(true);
    expect(
      shouldShowPushPrompt({ now: NOW, state: state(null, 0), permission: 'undetermined' }),
    ).toBe(true);
  });

  it('waits two days after each of the first three dismissals', () => {
    for (const count of [1, 2, 3 - 1]) {
      expect(show(EARLY_GAP_MS - 1, count)).toBe(false);
      expect(show(EARLY_GAP_MS, count)).toBe(true);
    }
  });

  it('goes weekly from the third dismissal on', () => {
    for (const count of [3, 4, 10]) {
      expect(show(EARLY_GAP_MS, count)).toBe(false);
      expect(show(LATE_GAP_MS - 1, count)).toBe(false);
      expect(show(LATE_GAP_MS, count)).toBe(true);
    }
  });

  it('lets a group join ask sooner, but not more than once a day', () => {
    expect(show(JOIN_GAP_MS - 1, 1, { afterJoin: true })).toBe(false);
    expect(show(JOIN_GAP_MS, 1, { afterJoin: true })).toBe(true);
    // Even in the weekly phase.
    expect(show(JOIN_GAP_MS, 5, { afterJoin: true })).toBe(true);
    expect(show(null, 0, { afterJoin: true })).toBe(true);
  });

  it('is not silenced by a clock that moved backwards', () => {
    expect(show(-EARLY_GAP_MS, 1)).toBe(true);
  });
});

describe('pushCtaAction', () => {
  it('asks while the system will still show its dialog', () => {
    expect(pushCtaAction({ permission: 'undetermined', canAskAgain: true })).toBe('request');
    expect(pushCtaAction({ permission: 'denied', canAskAgain: true })).toBe('request');
  });

  it('opens settings once the system will not ask again', () => {
    expect(pushCtaAction({ permission: 'denied', canAskAgain: false })).toBe('settings');
  });
});

describe('parsePushPromptState', () => {
  it('reads what was saved and survives junk', () => {
    expect(parsePushPromptState(JSON.stringify({ lastShownAt: 5, dismissCount: 2 }))).toEqual({
      lastShownAt: 5,
      dismissCount: 2,
    });
    const empty = { lastShownAt: null, dismissCount: 0 };
    expect(parsePushPromptState(null)).toEqual(empty);
    expect(parsePushPromptState('{nope')).toEqual(empty);
    expect(parsePushPromptState('{"lastShownAt":"x","dismissCount":-1}')).toEqual(empty);
  });
});
