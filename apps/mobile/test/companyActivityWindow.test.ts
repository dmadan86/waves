import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_WINDOW_DAYS,
  activityCutoff,
  activityWindow,
  stampInWindow,
  type CompanyActivityEvent,
} from '../src/lib/companyActivity';

const now = new Date(2026, 10, 10, 15, 0).getTime();
const daysAgo = (n: number): number => new Date(2026, 10, 10 - n, 12, 0).getTime();
const ev = (id: string, at: number): CompanyActivityEvent => ({ id, at }) as CompanyActivityEvent;
const events = [ev('new', daysAgo(1)), ev('edge', daysAgo(15)), ev('old', daysAgo(25))];

describe('activity window', () => {
  it('keeps the last 15 days and drops older events', () => {
    const cut = activityCutoff(now, ACTIVITY_WINDOW_DAYS);
    expect(activityWindow(events, cut).map((e) => e.id)).toEqual(['new', 'edge']);
  });

  it('extending by 15 days brings the older events in', () => {
    const cut = activityCutoff(now, ACTIVITY_WINDOW_DAYS * 2);
    expect(activityWindow(events, cut).map((e) => e.id)).toEqual(['new', 'edge', 'old']);
  });

  it('filters raw row stamps before building', () => {
    const cut = activityCutoff(now, ACTIVITY_WINDOW_DAYS);
    expect(stampInWindow(cut, new Date(daysAgo(25)).toISOString())).toBe(false);
    expect(
      stampInWindow(cut, new Date(daysAgo(25)).toISOString(), new Date(daysAgo(2)).toISOString()),
    ).toBe(true);
  });
});
