/**
 * What the planner reads out of two tables.
 *
 * `buildTimeline` is core's and tested there. What is tested here is the pair
 * of conversions in front of it, both of which fail in ways a screen does not
 * look broken doing:
 *
 * - `done` is a **timestamp column**, not a boolean. Read as one, every item
 *   comes back unticked — and the tick still appears to work, because the write
 *   succeeded; it is only the next load that forgets.
 * - the trip's day is decided in the **trip's timezone**, so "today" is the
 *   same row for everybody on it, whatever time it is where they are reading.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildTimeline, dayNumber } from '@waves/core';

import {
  planItems,
  timelineExpenses,
  todayIn,
  type PlanSource,
  type TimelineSource,
} from '../src/lib/planRows';

function row(over: Partial<PlanSource> & Pick<PlanSource, 'id' | 'day' | 'title'>): PlanSource {
  return {
    starts_at: null,
    note: null,
    category: null,
    planned_minor: null,
    currency: 'INR',
    done_at: null,
    expense_id: null,
    position: 0,
    ...over,
  };
}

function bill(
  id: string,
  expense_date: string,
  amount: string,
  extra: { deleted?: boolean; currency?: string; description?: string } = {},
): TimelineSource {
  return {
    id,
    deleted_at: extra.deleted ? '2026-03-20T00:00:00Z' : null,
    currentVersion: {
      description: extra.description ?? id,
      category: 'food',
      expense_date,
      amount,
      currency: extra.currency ?? 'INR',
    },
  };
}

describe('planItems', () => {
  it('reads "done" off the timestamp, not off a flag that is not there', () => {
    const items = planItems([
      row({ id: 'a', day: '2026-03-14', title: 'Falls', done_at: '2026-03-14T09:00:00Z' }),
      row({ id: 'b', day: '2026-03-14', title: 'Dinner' }),
    ]);
    expect(items.map((item) => item.done)).toEqual([true, false]);
  });

  it('shortens the time to what a plan says, and keeps null as null', () => {
    const items = planItems([
      row({ id: 'a', day: '2026-03-14', title: 'Train', starts_at: '09:30:00' }),
      row({ id: 'b', day: '2026-03-14', title: 'Whenever' }),
    ]);
    expect(items[0]!.startsAt).toBe('09:30');
    expect(items[1]!.startsAt).toBeNull();
  });

  it('keeps the planned amount in minor units, and null when nobody guessed', () => {
    const items = planItems([
      row({ id: 'a', day: '2026-03-14', title: 'Boat', planned_minor: '200000' }),
      row({ id: 'b', day: '2026-03-14', title: 'Walk' }),
    ]);
    expect(items[0]!.plannedMinor).toBe(200000n);
    expect(items[1]!.plannedMinor).toBeNull();
  });
});

describe('timelineExpenses', () => {
  it('drops a deleted bill and one with no current version', () => {
    const rows = timelineExpenses([
      bill('a', '2026-03-14', '315000'),
      bill('gone', '2026-03-14', '900000', { deleted: true }),
      { id: 'headless', deleted_at: null, currentVersion: null },
    ]);
    expect(rows.map((expense) => expense.id)).toEqual(['a']);
  });

  it('takes the day off the date string, so no timezone can move a bill', () => {
    const rows = timelineExpenses([bill('a', '2026-03-14T23:45:00Z', '1000')]);
    expect(rows[0]!.date).toBe('2026-03-14');
  });
});

describe('the two halves meeting in buildTimeline', () => {
  it('puts a day’s plan and its spend on the same row of the trip', () => {
    const timeline = buildTimeline({
      items: planItems([
        row({ id: 'p', day: '2026-03-14', title: 'Falls', planned_minor: '200000' }),
      ]),
      expenses: timelineExpenses([bill('e', '2026-03-14', '315000')]),
      startDate: '2026-03-14',
      endDate: '2026-03-16',
    });
    // Three days, because an empty day is one somebody can still plan into.
    expect(timeline.days.map((day) => day.day)).toEqual(['2026-03-14', '2026-03-15', '2026-03-16']);
    const first = timeline.days[0]!;
    expect(first.items).toHaveLength(1);
    expect(first.expenses).toHaveLength(1);
    // Planned and spent side by side, never added.
    expect(first.plannedByCurrency.INR).toBe(200000n);
    expect(first.spentByCurrency.INR).toBe(315000n);
  });

  it('keeps currencies apart on a day that mixed them', () => {
    const timeline = buildTimeline({
      items: [],
      expenses: timelineExpenses([
        bill('a', '2026-03-14', '315000'),
        bill('b', '2026-03-14', '4000', { currency: 'THB' }),
      ]),
      startDate: null,
      endDate: null,
    });
    expect(timeline.spentByCurrency).toEqual({ INR: 315000n, THB: 4000n });
  });
});

describe('todayIn', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers with the trip’s day, not the reader’s', () => {
    // 22:30 UTC on the 14th is already the 15th in Kolkata (UTC+5:30) and still
    // the 14th in New York. Somebody reading their Goa itinerary from New York
    // is on the same day of the trip as everybody standing in Goa.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-14T22:30:00Z'));
    expect(todayIn('Asia/Kolkata')).toBe('2026-03-15');
    expect(todayIn('America/New_York')).toBe('2026-03-14');
  });

  it('still names a day when the zone is one Intl has never heard of', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-14T22:30:00Z'));
    // A planner that cannot name today is still a planner.
    expect(todayIn('Mars/Olympus_Mons')).toBe('2026-03-14');
  });

  it('is the string dayNumber compares against', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-16T04:00:00Z'));
    const today = todayIn('Asia/Kolkata');
    expect(dayNumber(today, '2026-03-14', '2026-03-20')).toBe(3);
    // Outside the trip is not a day of it.
    expect(dayNumber(today, '2026-04-01', '2026-04-05')).toBeNull();
  });
});
