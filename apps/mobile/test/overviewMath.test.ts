import { describe, expect, it } from 'vitest';

import {
  absentStreak,
  agoText,
  attendanceSegments,
  buildEscalations,
  buildUpcomingCards,
  compactMoney,
  pct,
  vsLastMonth,
} from '../src/lib/overviewMath';

describe('overview math', () => {
  it('rounds percentages and shows nothing for zero employees', () => {
    expect(pct(4, 6)).toBe(67);
    expect(pct(1, 6)).toBe(17);
    expect(pct(0, 0)).toBeNull();
    expect(pct(7, 6)).toBe(100);
  });
  it('groups the Indian way and shortens crores', () => {
    const cr = '{n} Cr';
    expect(compactMoney(1250000n, 'INR', 'en-IN', cr)).toBe('₹12,500');
    expect(compactMoney(12500000n, 'INR', 'en-IN', cr)).toBe('₹1,25,000');
    expect(compactMoney(1234n, 'INR', 'en-IN', cr)).toBe('₹12.34');
    expect(compactMoney(1250000000n, 'INR', 'en-IN', cr)).toBe('₹1.25 Cr');
    expect(compactMoney(1000000000n, 'INR', 'en-IN', cr)).toBe('₹1 Cr');
    expect(compactMoney(0n, 'INR', 'en-IN', cr)).toBe('₹0');
  });
  it('builds attendance bar segments in order and drops zeros', () => {
    expect(attendanceSegments({ present: 4, leave: 2, absent: 1, unmarked: 1 })).toEqual([
      { key: 'present', n: 4 },
      { key: 'leave', n: 2 },
      { key: 'unmarked', n: 1 },
      { key: 'absent', n: 1 },
    ]);
    expect(attendanceSegments({ present: 0, leave: 0, absent: 0, unmarked: 3 })).toEqual([
      { key: 'unmarked', n: 3 },
    ]);
    expect(attendanceSegments({ present: 0, leave: 0, absent: 0, unmarked: 0 })).toEqual([]);
  });
  it('compares paid this month with last month on integer money', () => {
    expect(vsLastMonth(472300n, 421700n)).toEqual({ dir: 'up', pct: 12 });
    expect(vsLastMonth(300n, 400n)).toEqual({ dir: 'down', pct: 25 });
    expect(vsLastMonth(100n, 0n)).toBeNull();
    expect(vsLastMonth(0n, 0n)).toBeNull();
    expect(vsLastMonth(1001n, 1000n)).toBeNull();
    expect(vsLastMonth(0n, 500n)).toEqual({ dir: 'down', pct: 100 });
    // Far beyond Number's safe range stays exact.
    expect(vsLastMonth(2_000_000_000_000_000_000n, 1_000_000_000_000_000_000n)).toEqual({
      dir: 'up',
      pct: 100,
    });
  });
  it('counts a streak of absent or unmarked days, newest first', () => {
    expect(absentStreak(['absent', 'absent', 'absent', 'present'])).toBe(3);
    // Today not marked yet does not count, yesterday and before do.
    expect(absentStreak(['unmarked', 'absent', 'unmarked', 'unmarked', 'present'])).toBe(3);
    expect(absentStreak(['present', 'absent', 'absent', 'absent'])).toBe(0);
    expect(absentStreak(['absent', 'absent', 'leave', 'absent', 'absent'])).toBe(2);
    // A day nobody was marked neither counts nor breaks the run.
    expect(absentStreak(['absent', 'off', 'off', 'absent', 'absent'])).toBe(3);
    expect(absentStreak([])).toBe(0);
  });
  it('lists the newest escalations, capped, with the whole count for the badge', () => {
    const row = (key: string, at: number) => ({
      key,
      kind: 'expense' as const,
      name: key,
      memberId: null,
      amountMinor: null,
      at,
    });
    const out = buildEscalations([row('a', 1), row('b', 5), row('c', 3), row('d', 4)], 3);
    expect(out.items.map((r) => r.key)).toEqual(['b', 'd', 'c']);
    expect(out.total).toBe(4);
    expect(buildEscalations([])).toEqual({ items: [], total: 0 });
  });
  it('says how long ago', () => {
    const now = Date.parse('2026-10-30T12:00:00Z');
    expect(agoText(now - 20_000, now)).toEqual({ unit: 'now', n: 0 });
    expect(agoText(now - 59 * 60_000, now)).toEqual({ unit: 'min', n: 59 });
    expect(agoText(now - 3 * 3_600_000, now)).toEqual({ unit: 'hour', n: 3 });
    expect(agoText(now - 50 * 3_600_000, now)).toEqual({ unit: 'day', n: 2 });
    expect(agoText(now + 5000, now)).toEqual({ unit: 'now', n: 0 });
  });
  it('turns calendar items into upcoming cards', () => {
    const today = '2026-10-30';
    const it = (
      id: string,
      day: string,
      subKind: string,
      extra: Partial<Parameters<typeof buildUpcomingCards>[0][number]> = {},
    ) => ({ id, day, subKind, title: id, time: null, memberId: null, ...extra });
    const cards = buildUpcomingCards(
      [
        it('h1:2026-11-10', '2026-11-10', 'holiday', {
          rangeStart: '2026-11-10',
          rangeEnd: '2026-11-12',
        }),
        it('h1:2026-11-11', '2026-11-11', 'holiday', {
          rangeStart: '2026-11-10',
          rangeEnd: '2026-11-12',
        }),
        it('w1', '2026-11-01', 'wage', { memberId: 'a' }),
        it('w2', '2026-11-01', 'wage', { memberId: 'b' }),
        it('e1', today, 'event', { time: '19:00', people: ['a', 'b'] }),
        it('old', '2026-10-01', 'event'),
        it('runs', '2026-10-29', 'holiday', { rangeStart: '2026-10-29', rangeEnd: '2026-10-30' }),
        it('bill', '2026-11-02', 'vendor_bill'),
      ],
      today,
    );
    expect(cards.map((c) => [c.kind, c.day, c.endDay])).toEqual([
      ['holiday', '2026-10-29', '2026-10-30'],
      ['event', today, today],
      ['payroll', '2026-11-01', '2026-11-01'],
      ['holiday', '2026-11-10', '2026-11-12'],
    ]);
    expect(cards.find((c) => c.kind === 'payroll')?.people).toEqual(['a', 'b']);
    expect(buildUpcomingCards([], today)).toEqual([]);
  });
});
