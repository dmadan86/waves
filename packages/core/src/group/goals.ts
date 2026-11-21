/**
 * Joint goals: money a group puts aside together toward one thing.
 *
 * Pure and bigint throughout; `today` always arrives as an argument (a
 * `YYYY-MM-DD` string), nothing reads a clock. Wording rule for callers: this is
 * money "put aside", never "saved" or "invested", and nothing here counts
 * returns — every projection is straight arithmetic.
 */

export interface GoalShape {
  readonly targetMinor: bigint;
  readonly currency: string;
  /** `YYYY-MM-DD`, or null when the goal has no date. */
  readonly targetDate: string | null;
  /** When the goal was made; only its date part is read. */
  readonly createdAt: string;
  /** Each member's monthly amount in minor units. */
  readonly monthlyPlan: Readonly<Record<string, bigint>>;
}

export interface GoalLine {
  readonly memberId: string;
  /** Signed: negative is money taken out. */
  readonly amountMinor: bigint;
  readonly date: string;
  /** Present only where a caller carries one; a mismatch with the goal is refused. */
  readonly currency?: string;
}

export type GoalPace = 'done' | 'on_track' | 'behind' | 'no_date' | 'past_due';

export class GoalCurrencyError extends Error {
  constructor(goal: string, line: string) {
    super(`goal is in ${goal}; a line in ${line} cannot be added`);
    this.name = 'GoalCurrencyError';
  }
}

const dayNumber = (iso: string): number => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 86_400_000;
};

/** Total put aside (never below zero). Throws on a line in another currency. */
export function putAsideTotal(
  goal: Pick<GoalShape, 'currency'>,
  lines: readonly GoalLine[],
): bigint {
  let total = 0n;
  for (const line of lines) {
    if (line.currency !== undefined && line.currency !== goal.currency) {
      throw new GoalCurrencyError(goal.currency, line.currency);
    }
    total += line.amountMinor;
  }
  return total < 0n ? 0n : total;
}

/** Whole percent 0..100 (rounded down, so 100 means the target is reached). */
export function goalProgressPct(goal: Pick<GoalShape, 'targetMinor'>, total: bigint): number {
  if (goal.targetMinor <= 0n || total <= 0n) return 0;
  if (total >= goal.targetMinor) return 100;
  return Number((total * 100n) / goal.targetMinor);
}

/**
 * Where a straight line from the day the goal was made to its date puts the
 * total today. Null with no date; 0 before the start; the whole target on or
 * after the date.
 */
export function expectedByToday(
  goal: Pick<GoalShape, 'targetMinor' | 'targetDate' | 'createdAt'>,
  today: string,
): bigint | null {
  if (goal.targetDate === null) return null;
  const start = dayNumber(goal.createdAt);
  const end = dayNumber(goal.targetDate);
  const now = dayNumber(today);
  if (now >= end || end <= start) return goal.targetMinor;
  if (now <= start) return 0n;
  return (goal.targetMinor * BigInt(now - start)) / BigInt(end - start);
}

export function goalPace(
  goal: Pick<GoalShape, 'targetMinor' | 'targetDate' | 'createdAt'>,
  total: bigint,
  today: string,
): GoalPace {
  if (total >= goal.targetMinor) return 'done';
  if (goal.targetDate === null) return 'no_date';
  if (dayNumber(today) > dayNumber(goal.targetDate)) return 'past_due';
  const expected = expectedByToday(goal, today) ?? 0n;
  return total >= expected ? 'on_track' : 'behind';
}

/** Calendar months from `today` to the date, a started month counting as one. 0 once the date is reached. */
export function monthsLeft(targetDate: string | null, today: string): number | null {
  if (targetDate === null) return null;
  if (dayNumber(today) >= dayNumber(targetDate)) return 0;
  const [ty, tm, td] = targetDate.split('-').map(Number);
  const [y, m, d] = today.split('-').map(Number);
  const months = ((ty ?? 0) - (y ?? 0)) * 12 + ((tm ?? 0) - (m ?? 0));
  return Math.max(months + ((td ?? 0) > (d ?? 0) ? 1 : 0), 1);
}

/**
 * What the group must put aside each month, from now, to reach the target by
 * the date. Null with no date; 0 once reached; the whole remainder in a final
 * month when the date is this month or has passed.
 */
export function monthlyNeeded(
  goal: Pick<GoalShape, 'targetMinor' | 'targetDate'>,
  total: bigint,
  today: string,
): bigint | null {
  const months = monthsLeft(goal.targetDate, today);
  if (months === null) return null;
  const remaining = goal.targetMinor - total;
  if (remaining <= 0n) return 0n;
  const n = BigInt(Math.max(months, 1));
  return (remaining + n - 1n) / n;
}

export interface MemberMonthStatus {
  readonly memberId: string;
  readonly plannedMinor: bigint;
  readonly putAsideMinor: bigint;
  /** True when this month's total reaches the plan. */
  readonly met: boolean;
  /** How far under the plan, 0 when met. */
  readonly shortMinor: bigint;
}

/** Each planned member's month (`YYYY-MM`) against their monthly amount. */
export function memberMonthStatus(
  goal: Pick<GoalShape, 'monthlyPlan' | 'currency'>,
  lines: readonly GoalLine[],
  month: string,
): MemberMonthStatus[] {
  putAsideTotal(goal, lines); // refuses a foreign currency
  return Object.entries(goal.monthlyPlan)
    .filter(([, planned]) => planned > 0n)
    .map(([memberId, plannedMinor]) => {
      let put = 0n;
      for (const line of lines) {
        if (line.memberId === memberId && line.date.startsWith(month)) put += line.amountMinor;
      }
      const putAsideMinor = put < 0n ? 0n : put;
      const short = plannedMinor - putAsideMinor;
      return {
        memberId,
        plannedMinor,
        putAsideMinor,
        met: short <= 0n,
        shortMinor: short > 0n ? short : 0n,
      };
    });
}
