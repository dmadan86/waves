/** Small wording helpers shared by the goals card and screens. */

import { format, money, type CurrencyCode, type GoalPace } from '@waves/core';

import type { UiStrings } from '@/i18n';

/** A whole-unit amount in the reader's locale. */
export const goalAmount = (minor: bigint, currency: CurrencyCode, locale: string): string =>
  format(money(minor, currency), { locale, whole: true });

/** The pill's words and tone for a pace; null when the goal has nothing to say. */
export function paceLabel(
  pace: GoalPace,
  t: UiStrings['groupGoals'],
): { text: string; tone: 'positive' | 'negative' | 'muted' } | null {
  switch (pace) {
    case 'done':
      return { text: t.statusDone, tone: 'positive' };
    case 'on_track':
      return { text: t.statusOnTrack, tone: 'positive' };
    case 'behind':
      return { text: t.statusBehind, tone: 'negative' };
    case 'past_due':
      return { text: t.statusPastDue, tone: 'negative' };
    default:
      return null;
  }
}

/** "June 2035". */
export const goalMonthYear = (iso: string, locale: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
  });
};

/** "Nov". */
export const goalMonthShort = (month: string, locale: string): string => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, 1).toLocaleDateString(locale, { month: 'short' });
};
