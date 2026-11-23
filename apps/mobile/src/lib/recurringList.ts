import type { PersonalRecurring } from '@waves/core';

import { monthlyEquivalent } from './personalSetup';

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
export function nextDateLabel(isoDate: string, locale: string, todayIso?: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const now = todayIso
    ? (() => {
        const [todayYear, todayMonth, todayDay] = todayIso.split('-').map(Number);
        return new Date(todayYear, todayMonth - 1, todayDay);
      })()
    : new Date();
  const yearLater = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
  const includeYear = date > yearLater;
  return dateTimeFormat(
    locale,
    includeYear
      ? { day: 'numeric', month: 'short', year: 'numeric' }
      : { day: 'numeric', month: 'short' },
  ).format(date);
}

export function sectionRecurrings<T extends PersonalRecurring>(rules: readonly T[]) {
  const order = (a: T, b: T) => a.nextDate.localeCompare(b.nextDate);
  const income = rules.filter((rule) => rule.txnKind === 'income').sort(order);
  const expense = rules.filter((rule) => rule.txnKind !== 'income').sort(order);
  return {
    income,
    expense,
    incomeTotal: income
      .filter((rule) => rule.active)
      .reduce((sum, rule) => sum + monthlyEquivalent(rule), 0n),
    expenseTotal: expense
      .filter((rule) => rule.active)
      .reduce((sum, rule) => sum + monthlyEquivalent(rule), 0n),
  };
}
