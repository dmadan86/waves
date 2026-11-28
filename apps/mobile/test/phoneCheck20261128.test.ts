import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { WEEK_START } from '../src/lib/calendarGrid';
import { spendByDate, weekDays } from '../src/lib/calm/weekPace';

const read = (p: string): string => readFileSync(join(__dirname, '..', p), 'utf8');

describe('Today week', () => {
  it('runs Monday to Sunday: Sat 28 Nov 2026 sits in Mon 23 - Sun 29', () => {
    const days = weekDays({
      today: '2026-11-28',
      weekStart: WEEK_START,
      spent: spendByDate([], 'INR', '2026-11-23', '2026-11-29'),
      pace: null,
      dueDates: new Set(),
    });
    expect(days.map((d) => d.date)).toEqual([
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
      '2026-11-27',
      '2026-11-28',
      '2026-11-29',
    ]);
    expect(days.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });
  const today = read('src/components/personal/PersonalToday.tsx');
  it('uses WEEK_START for the strip and the weekly sum, not the locale', () => {
    expect(today).not.toMatch(/firstWeekday\(/);
    expect(today.match(/WEEK_START/g)!.length).toBeGreaterThanOrEqual(2);
  });
  it('names the later section Coming up with See all to the calendar', () => {
    expect(today).not.toMatch(/c\.later/);
    expect(today).toMatch(/t\.calendar\.comingUp/);
    expect(today).toMatch(/t\.calendar\.seeAll/);
    expect(today).toMatch(/\/personal\/calendar/);
  });
});

describe('headers', () => {
  const rentals = read('src/app/rentals/index.tsx');
  it('Rentals uses the standard round-back header', () => {
    expect(rentals).not.toMatch(/CalmHeader/);
    expect(rentals).toMatch(/<PlainHeader/);
  });
  it('ListItem puts the chevron after a trailing pill', () => {
    const li = read('src/components/standard/ListItem.tsx');
    expect(li.indexOf('{trailing}')).toBeGreaterThan(-1);
    expect(li.indexOf('{trailing}')).toBeLessThan(li.lastIndexOf('{chevronNode}'));
  });
  it('Transactions, Recurring, Budgets, Loans and Planning share one HeaderBar family', () => {
    const planning = read('src/components/PlanningTabs.tsx');
    expect(planning).toMatch(/<HeaderBar/);
    for (const f of ['recurring', 'budgets', 'loans']) {
      const src = read(`src/app/personal/${f}.tsx`);
      expect(src).toMatch(new RegExp(`<PlanningHeader\\s+tab="${f}"`));
      expect(src).not.toMatch(/hideBack/);
    }
    // Tab roots have no back button; Budgets/Loans reached via the switch match Recurring.
    expect(planning).toMatch(/hideBack=\{tab === 'recurring' \|\| from === 'plan'\}/);
    expect(planning).toMatch(/params: \{ from: 'plan' \}/);
    expect(read('src/app/personal/transactions.tsx')).toMatch(/hideBack=\{!drillIn\}/);
    const tx = read('src/app/personal/transactions.tsx');
    expect(tx).toMatch(/<PlainHeader/);
    expect(tx).not.toMatch(/fontSize: 28/);
    // One title size, defined once, in the bar everyone renders.
    const bar = read('src/components/standard/HeaderBar.tsx');
    expect(bar).toMatch(/fontSize: 21/);
    expect(bar).toMatch(/fontSize: 13/);
  });
  it('Budgets draws no empty ListCard under the no-limits card', () => {
    expect(read('src/app/personal/budgets.tsx')).toMatch(/sortedBudgets\.length > 0 \?/);
  });
});
