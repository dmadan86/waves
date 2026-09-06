/**
 * The repeat patterns people actually name, and how each is stored.
 *
 * The model underneath is deliberately small — a cadence, a multiplier, and (for
 * twice a month) a second day — because a schedule that stores its own arithmetic
 * is a schedule that cannot be reasoned about. But nobody thinks in
 * `{ cadence: 'monthly', interval: 3 }`; they think "quarterly". This is the
 * translation between the two, kept in core so the mapping is pinned by tests
 * rather than living as a switch statement inside a picker.
 *
 * `custom` is the escape hatch: every N months, for the intervals that have no
 * name. It carries the interval itself rather than pretending to be a preset.
 */

import type { Cadence, PersonalRecurring } from './types';

export enum Frequency {
  Weekly = 'weekly',
  Fortnightly = 'fortnightly',
  TwiceAMonth = 'twiceAMonth',
  Monthly = 'monthly',
  Quarterly = 'quarterly',
  HalfYearly = 'halfYearly',
  Yearly = 'yearly',
  /** Every N months, N chosen by the person. */
  EveryNMonths = 'everyNMonths',
}

/** The named patterns, in the order a picker should offer them: most common
 *  first, the open-ended one last. */
export const FREQUENCIES: readonly Frequency[] = [
  Frequency.Monthly,
  Frequency.TwiceAMonth,
  Frequency.Weekly,
  Frequency.Fortnightly,
  Frequency.Quarterly,
  Frequency.HalfYearly,
  Frequency.Yearly,
  Frequency.EveryNMonths,
];

export interface Schedule {
  readonly cadence: Cadence;
  readonly interval: number;
  /** Only ever set for `twiceAMonth`. */
  readonly secondDay: number | null;
}

/** How a named pattern is stored. `interval` is read only by `everyNMonths`;
 *  `secondDay` only by `twiceAMonth`. */
export function scheduleFor(
  frequency: Frequency,
  options: { readonly interval?: number; readonly secondDay?: number | null } = {},
): Schedule {
  const months = (n: number): Schedule => ({ cadence: 'monthly', interval: n, secondDay: null });
  switch (frequency) {
    case Frequency.Weekly:
      return { cadence: 'weekly', interval: 1, secondDay: null };
    case Frequency.Fortnightly:
      return { cadence: 'weekly', interval: 2, secondDay: null };
    case Frequency.TwiceAMonth:
      return {
        cadence: 'semimonthly',
        interval: 1,
        // A rule that says "twice a month" and carries no second day would fire
        // once, so it falls back to the middle of the month rather than quietly
        // becoming monthly.
        secondDay: options.secondDay ?? 15,
      };
    case Frequency.Quarterly:
      return months(3);
    case Frequency.HalfYearly:
      return months(6);
    case Frequency.Yearly:
      return { cadence: 'yearly', interval: 1, secondDay: null };
    case Frequency.EveryNMonths: {
      const n = options.interval;
      return months(Number.isInteger(n) && (n as number) > 0 ? (n as number) : 2);
    }
    case Frequency.Monthly:
    default:
      return months(1);
  }
}

/**
 * Which named pattern a stored rule is — the inverse of `scheduleFor`, for
 * showing an existing rule in the picker it was made with.
 *
 * A monthly interval with no name of its own reads as `everyNMonths`, never as
 * "monthly": a rule that fires every five months must not open in the editor
 * claiming to be monthly and then quietly become monthly on save.
 */
export function frequencyOf(rule: Pick<PersonalRecurring, 'cadence' | 'interval'>): Frequency {
  const interval = rule.interval > 0 ? Math.floor(rule.interval) : 1;
  if (rule.cadence === 'semimonthly') return Frequency.TwiceAMonth;
  if (rule.cadence === 'weekly') return interval === 2 ? Frequency.Fortnightly : Frequency.Weekly;
  if (rule.cadence === 'yearly') return Frequency.Yearly;
  if (interval === 1) return Frequency.Monthly;
  if (interval === 3) return Frequency.Quarterly;
  if (interval === 6) return Frequency.HalfYearly;
  return Frequency.EveryNMonths;
}
