import type { CapPeriod } from '@waves/core';

import { fill, type UiStrings } from '@/i18n';

/** "a week" / "every 3 days" (a rule) or "this week" / "in the last 3 days" (usage). */
export function capPeriodWord(
  t: UiStrings,
  period: CapPeriod,
  days: number,
  as: 'rule' | 'usage',
): string {
  const c = t.company;
  if (period === 'week') return as === 'rule' ? c.capPerWeek : c.capUseWeek;
  if (period === 'month') return as === 'rule' ? c.capPerMonth : c.capUseMonth;
  if (period === 'year') return as === 'rule' ? c.capPerYear : c.capUseYear;
  if (days === 1) return as === 'rule' ? c.capPerDay : c.capUseToday;
  return fill(as === 'rule' ? c.capPerDays : c.capUseDays, { n: days });
}
