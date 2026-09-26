import { describe, expect, it } from 'vitest';

import {
  clusterPins,
  dayRoute,
  filterTimeline,
  localDay,
  mappedDays,
  rangeStart,
  regionFor,
  replaySteps,
  rowIndexOf,
  timeOfDay,
  timelineDays,
  timelineRows,
  type TimelineEntry,
} from '../src/lib/timeline';

/** A local wall-clock time as epoch ms, so tests read in the phone's calendar. */
function at(day: string, hh: number, mm = 0): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, hh, mm).getTime();
}

function entry(overrides: Partial<TimelineEntry> & { id: string }): TimelineEntry {
  return {
    groupId: 'g1',
    groupName: 'Goa',
    description: 'Dinner',
    category: 'food',
    categoryMeta: null,
    amount: 100000n,
    currency: 'INR',
    day: '2026-09-14',
    at: null,
    place: null,
    mine: true,
    myNet: 0n,
    pending: false,
    ...overrides,
  };
}

describe('timeOfDay', () => {
  it('uses the save time when it was saved on the bill’s own day', () => {
    const saved = new Date(at('2026-09-14', 19, 42)).toISOString();
    expect(timeOfDay('2026-09-14', saved)).toBe(at('2026-09-14', 19, 42));
  });

  it('shows no time for a bill typed in on a later day', () => {
    const saved = new Date(at('2026-09-17', 9)).toISOString();
    expect(timeOfDay('2026-09-14', saved)).toBeNull();
  });

  it('shows no time without a save time', () => {
    expect(timeOfDay('2026-09-14', null)).toBeNull();
  });
});

describe('filterTimeline', () => {
  const rows = [
    entry({ id: 'a', day: '2026-09-25' }),
    entry({ id: 'b', day: '2026-09-01', groupId: 'g2' }),
    entry({ id: 'c', day: '2026-06-01', mine: false }),
  ];

  it('counts today as day one of a range', () => {
    expect(rangeStart('7d', '2026-09-26')).toBe('2026-09-20');
    expect(rangeStart('all', '2026-09-26')).toBeNull();
  });

  it('filters by range, group and "only mine" together', () => {
    const today = '2026-09-26';
    const ids = (f: Parameters<typeof filterTimeline>[1]) =>
      filterTimeline(rows, f, today).map((e) => e.id);
    expect(ids({ range: 'all', groupId: null, onlyMine: false })).toEqual(['a', 'b', 'c']);
    expect(ids({ range: '30d', groupId: null, onlyMine: false })).toEqual(['a', 'b']);
    expect(ids({ range: 'all', groupId: 'g2', onlyMine: false })).toEqual(['b']);
    expect(ids({ range: 'all', groupId: null, onlyMine: true })).toEqual(['a', 'b']);
  });
});

describe('timelineDays', () => {
  it('puts days newest first and a day’s bills in the order they happened', () => {
    const days = timelineDays([
      entry({ id: 'late', day: '2026-09-14', at: at('2026-09-14', 21) }),
      entry({ id: 'untimed', day: '2026-09-14', at: null }),
      entry({ id: 'early', day: '2026-09-14', at: at('2026-09-14', 8) }),
      entry({ id: 'newer-day', day: '2026-09-15', at: at('2026-09-15', 12) }),
    ]);
    expect(days.map((d) => d.day)).toEqual(['2026-09-15', '2026-09-14']);
    expect(days[1]!.entries.map((e) => e.id)).toEqual(['early', 'late', 'untimed']);
  });

  it('totals a day per currency and never across them', () => {
    const [day] = timelineDays([
      entry({ id: 'a', amount: 1000n, currency: 'INR' }),
      entry({ id: 'b', amount: 2500n, currency: 'INR' }),
      entry({ id: 'c', amount: 900n, currency: 'USD' }),
    ]);
    expect(day!.totals.get('INR')).toBe(3500n);
    expect(day!.totals.get('USD')).toBe(900n);
  });
});

describe('timelineRows', () => {
  it('marks a quiet stretch of three hours or more with a break', () => {
    const rows = timelineRows(
      timelineDays([
        entry({ id: 'breakfast', at: at('2026-09-14', 8) }),
        entry({ id: 'coffee', at: at('2026-09-14', 9) }),
        entry({ id: 'dinner', at: at('2026-09-14', 20) }),
      ]),
    );
    expect(rows.map((r) => r.kind)).toEqual(['day', 'entry', 'entry', 'gap', 'entry']);
    const gap = rows[3];
    expect(gap?.kind === 'gap' && gap.hours).toBe(11);
  });

  it('knows the first and last bill of each day, for the rail', () => {
    const rows = timelineRows(
      timelineDays([entry({ id: 'a', at: at('2026-09-14', 8) }), entry({ id: 'b' })]),
    );
    const entries = rows.filter((r) => r.kind === 'entry');
    expect(entries.map((r) => r.kind === 'entry' && [r.first, r.last])).toEqual([
      [true, false],
      [false, true],
    ]);
    expect(rowIndexOf(rows, 'b')).toBe(2);
    expect(rowIndexOf(rows, 'missing')).toBe(-1);
  });
});

describe('the map', () => {
  const region = { latitude: 15.5, longitude: 73.8, latitudeDelta: 0.1, longitudeDelta: 0.1 };
  const size = { width: 400, height: 400 };

  it('merges pins that would overlap and keeps far ones apart', () => {
    const clusters = clusterPins(
      [
        entry({ id: 'a', amount: 1000n, place: { lat: 15.5001, lng: 73.8001 } }),
        entry({ id: 'b', amount: 2000n, place: { lat: 15.5002, lng: 73.8002 } }),
        entry({ id: 'far', place: { lat: 15.54, lng: 73.84 } }),
        entry({ id: 'nowhere', place: null }),
      ],
      region,
      size,
    );
    const sizes = clusters.map((c) => c.entries.length).sort();
    expect(sizes).toEqual([1, 2]);
    const pair = clusters.find((c) => c.entries.length === 2)!;
    expect(pair.id).toBe('a');
    expect(pair.total).toEqual({ amount: 3000n, currency: 'INR' });
  });

  it('gives a mixed-currency bubble no single total', () => {
    const [cluster] = clusterPins(
      [
        entry({ id: 'a', place: { lat: 15.5, lng: 73.8 } }),
        entry({ id: 'b', currency: 'USD', place: { lat: 15.5, lng: 73.8 } }),
      ],
      region,
      size,
    );
    expect(cluster!.total).toBeNull();
  });

  it('frames every point with a street-level floor', () => {
    expect(regionFor([])).toBeNull();
    const one = regionFor([{ lat: 15.5, lng: 73.8 }])!;
    expect(one.latitude).toBeCloseTo(15.5);
    expect(one.latitudeDelta).toBeGreaterThanOrEqual(0.01);
  });

  it('routes a day through its pinned bills in time order, with a running total', () => {
    const days = timelineDays([
      entry({ id: 'lunch', amount: 500n, at: at('2026-09-14', 13), place: { lat: 1, lng: 1 } }),
      entry({ id: 'cab', amount: 200n, at: at('2026-09-14', 9), place: { lat: 2, lng: 2 } }),
      entry({ id: 'tip', amount: 50n, at: at('2026-09-14', 14), place: null }),
    ]);
    expect(dayRoute(days[0]).map((e) => e.id)).toEqual(['cab', 'lunch']);
    expect(replaySteps(days[0]).map((s) => s.soFar)).toEqual([200n, 700n]);
    expect(mappedDays(days).map((d) => d.day)).toEqual(['2026-09-14']);
  });
});

describe('localDay', () => {
  it('is the phone’s own calendar day', () => {
    expect(localDay(at('2026-01-02', 23, 30))).toBe('2026-01-02');
  });
});
