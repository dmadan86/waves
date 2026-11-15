// A birthday is stored as day + month only (no year); the picker needs a real date.
// 2024 is a leap year, so 29 Feb stays pickable.
const YEAR = 2024;

export type Birthday = { day: number; month: number };

export function birthdayToDate(b: Birthday): Date {
  return new Date(YEAR, b.month - 1, b.day, 12);
}

export function dateToBirthday(d: Date): Birthday {
  return { day: d.getDate(), month: d.getMonth() + 1 };
}

/** "17 Nov" in the reader's language, never a year. */
export function formatBirthday(b: Birthday, locale: string): string {
  return birthdayToDate(b).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}
