import type { UpcomingItem } from '@waves/core';

import { fill, plural, type UiStrings } from '@/i18n';

import { actionFor, type DateAction } from './actions';

type T = UiStrings['dates'];

export function titleOf(item: UpcomingItem, t: T): string {
  if (item.source === 'festival') return t.festivals[item.id as keyof T['festivals']];
  switch (item.kind) {
    case 'my_birthday':
      return t.titles.myBirthday;
    case 'anniversary':
      return t.titles.anniversary;
    case 'work_anniversary':
      return t.titles.workAnniversary;
    case 'family_birthday':
      return fill(t.titles.birthdayOf, { name: item.name });
    default:
      return fill(t.titles.other, { name: item.name });
  }
}

export function whenOf(item: UpcomingItem, t: T, locale: string): string {
  return item.inDays === 0 ? t.today : plural(locale, item.inDays, t.inDays);
}

export function subtitleOf(item: UpcomingItem, t: T, locale: string): string {
  if (item.years) return plural(locale, item.years, t.yearsAtWork);
  return whenOf(item, t, locale);
}

type Template = 'birthday' | 'anniversary' | 'work' | 'named';
const templateOf = (item: UpcomingItem): Template =>
  item.kind === 'family_birthday'
    ? 'birthday'
    : item.kind === 'anniversary'
      ? 'anniversary'
      : item.kind === 'work_anniversary'
        ? 'work'
        : 'named';

/** "Asha's birthday is in 5 days." */
export function headlineOf(item: UpcomingItem, t: T, locale: string): string {
  const r = t.reminder;
  const template = templateOf(item);
  const name = item.source === 'festival' ? titleOf(item, t) : item.name;
  const text = item.inDays === 0 ? r.today[template] : plural(locale, item.inDays, r[template]);
  return fill(text, { name });
}

/** The follow-up question, matching the one action the date offers. */
export function askOf(item: UpcomingItem, t: T): string {
  return t.reminder.ask[templateOf(item)];
}

export function actionLabel(action: DateAction, t: T): string {
  return t.actions[action];
}

export const hasAction = (item: UpcomingItem): boolean => actionFor(item) !== null;
