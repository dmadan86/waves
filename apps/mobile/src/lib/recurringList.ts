import {
  occurrences,
  type Occurrence,
  type PersonalRecurring,
  type PersonalTxn,
} from '@waves/core';

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

/**
 * What a rule has posted so far, newest first, plus this year's total.
 * Posts carry `recurringId`; older ones do not, so those are matched by kind,
 * note and amount. shortcut: the fallback can claim a look-alike one-off entry,
 * drop it once every old post has been relinked.
 */
export function rulePayments(
  rule: Pick<PersonalRecurring, 'id' | 'txnKind' | 'note' | 'amount'>,
  txns: readonly PersonalTxn[],
  today: string,
): { count: number; yearCount: number; yearTotal: bigint } {
  const note = rule.note?.trim().toLowerCase() ?? '';
  const mine = txns.filter(
    (txn) =>
      txn.recurringId === rule.id ||
      (!txn.recurringId &&
        note !== '' &&
        txn.kind === rule.txnKind &&
        txn.amount === rule.amount &&
        txn.note?.trim().toLowerCase() === note),
  );
  const year = mine.filter((txn) => txn.date.slice(0, 4) === today.slice(0, 4));
  return {
    count: mine.length,
    yearCount: year.length,
    yearTotal: year.reduce((sum, txn) => sum + txn.amount, 0n),
  };
}

/**
 * Every period of a rule, oldest first: back `lookbackYears`, forward to the next
 * due date. The end is not just today: a start date in the future, or a bill paid
 * ahead of time, has its payment dated after today and must still show.
 */
export function ruleTimeline(
  rule: PersonalRecurring,
  txns: readonly PersonalTxn[],
  today: string,
  lookbackYears: number,
): Occurrence[] {
  const from = `${Number(today.slice(0, 4)) - lookbackYears}${today.slice(4, 7)}-01`;
  let to = rule.nextDate > today ? rule.nextDate : today;
  for (const txn of txns) if (txn.recurringId === rule.id && txn.date > to) to = txn.date;
  return occurrences(rule, txns, { from, to }, today);
}
