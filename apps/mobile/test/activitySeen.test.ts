import { describe, expect, it } from 'vitest';

import { hasUnseenActivity } from '@/lib/activitySeen';

describe('hasUnseenActivity', () => {
  it('lights for news since the last look', () => {
    expect(hasUnseenActivity(2_000, 1_000)).toBe(true);
  });

  it('stays dark once the feed has been looked at, or with no news', () => {
    expect(hasUnseenActivity(1_000, 1_000)).toBe(false);
    expect(hasUnseenActivity(500, 1_000)).toBe(false);
    expect(hasUnseenActivity(0, 0)).toBe(false);
  });

  it('never lights before the last look has loaded', () => {
    expect(hasUnseenActivity(2_000, null)).toBe(false);
  });
});
