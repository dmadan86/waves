import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { householdBudgetNudge, householdNeeds, spendByDateRows } from '@/lib/householdToday';

const bill = (key: string, inDays: number) => ({
  key,
  kind: 'bill' as const,
  title: key,
  date: '2026-11-28',
  inDays,
  amount: 100n,
  currency: 'INR',
  ruleId: key,
});

describe('spendByDateRows', () => {
  it('sums per date inside the window, in one currency', () => {
    const rows = [
      { date: '2026-11-23', amount: 100n, currency: 'INR' },
      { date: '2026-11-23', amount: 50n, currency: 'INR' },
      { date: '2026-11-24', amount: 70n, currency: 'USD' },
      { date: '2026-11-30', amount: 9n, currency: 'INR' },
    ];
    expect(spendByDateRows(rows, 'INR', '2026-11-22', '2026-11-28')).toEqual({
      '2026-11-23': 150n,
    });
  });
});

describe('householdNeeds', () => {
  it('takes bills due today or overdue, overdue first, and a settle item when not settled', () => {
    const out = householdNeeds({
      upcoming: [bill('b', 0), bill('later', 3), bill('a', -2)],
      settled: false,
    });
    expect(out.map((n) => n.kind)).toEqual(['bill', 'bill', 'settle']);
    expect(out[0]).toMatchObject({ key: 'a' });
  });
  it('has no settle item when settled', () => {
    expect(householdNeeds({ upcoming: [], settled: true })).toEqual([]);
  });
});

describe('householdBudgetNudge', () => {
  it('is quiet with no budget or under 90 percent', () => {
    expect(householdBudgetNudge(null, 100n, '2026-11-10')).toBeNull();
    expect(householdBudgetNudge(1000n, 899n, '2026-11-10')).toBeNull();
  });
  it('reports percent, what is left and days left from 90 percent', () => {
    expect(householdBudgetNudge(1000n, 950n, '2026-11-10')).toEqual({
      percent: 95,
      remaining: 50n,
      daysLeft: 20,
    });
    expect(householdBudgetNudge(1000n, 1500n, '2026-11-10')?.remaining).toBe(-500n);
  });
});

describe('Family Home shares the Today pieces', () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  it('HouseholdScreen draws the calm header, week, needs card and coming-up list', () => {
    const hh = read('src/components/household/HouseholdScreen.tsx');
    for (const piece of ['<CalmHeader', '<TodayWeek', '<NeedsYouCard', '<NudgeRow'])
      expect(hh).toContain(piece);
    expect(hh).not.toContain('<TabHeader');
    expect(read('src/components/home/ComingUpHome.tsx')).toContain('<ComingUpList');
    expect(read('src/components/home/ComingUpHome.tsx')).not.toContain('c.dueTitle');
    expect(read('src/components/personal/PersonalToday.tsx')).toContain('<TodayWeek');
    expect(read('src/components/personal/PersonalToday.tsx')).toContain('<ComingUpList');
  });
});
