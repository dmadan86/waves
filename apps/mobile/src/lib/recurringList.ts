import type { PersonalRecurring } from '@waves/core';

import { dateTimeFormat } from './dateTimeFormat';

export type RecurringFilter = 'all' | 'bills' | 'income' | 'active' | 'paused';

export function filterRecurrings<T extends Pick<PersonalRecurring, 'txnKind' | 'active'>>(
  rules: readonly T[],
  filter: RecurringFilter,
): T[] {
  return rules.filter((rule) => {
    switch (filter) {
      case 'bills':
        return rule.txnKind !== 'income';
      case 'income':
        return rule.txnKind === 'income';
      case 'active':
        return rule.active;
      case 'paused':
        return !rule.active;
      case 'all':
        return true;
    }
  });
}

/** ISO calendar dates must be read at local midnight, without a UTC shift. */
export function nextDateLabel(isoDate: string, locale: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return dateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}
