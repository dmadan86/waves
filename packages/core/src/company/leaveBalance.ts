/**
 * Leave balance of one person for one leave type. Pure and deterministic: dates are ISO `YYYY-MM-DD`
 * strings, no Date objects, so no timezone can move a day. The SQL function `waves_company_leave_balance`
 * implements the SAME rules; change both together (packages/db/test/company-leave-policy.test.ts pins them).
 *
 * Rules (days are counted in hundredths so halves and quarters never drift):
 *  - Accrual starts in the later of: the type's first month, and the person's first month. A person
 *    who joined on day 1-15 earns that month; one who joined later starts the next month.
 *  - Each calendar month up to and including the `asOf` month earns `accrualPerMonth`.
 *  - Per calendar year the earned days are capped at `annualCap` (null = no cap).
 *  - Approved leave is deducted in the year it starts. Pending and rejected leave never count.
 *    Leave starting after the `asOf` month is ignored (it is checked on its own approval).
 *  - At each 1 January: carry forward = 0 when carry-forward is off; otherwise the year-end balance
 *    capped at `carryForwardCap` (null = no cap). A negative (overdrawn) balance carries as it is when
 *    carry-forward is on and resets to 0 when it is off.
 */
export interface LeaveBalanceRule {
  /** Days earned each month: 0-5 in halves (0.25 steps work too). */
  readonly accrualPerMonth: number;
  readonly carryForward: boolean;
  readonly carryForwardCap: number | null;
  readonly annualCap: number | null;
  /** First day the type exists (ISO). Months before it earn nothing. */
  readonly startDay: string;
}

export interface LeaveUse {
  readonly startDay: string;
  readonly endDay: string;
  readonly halfDay: boolean;
  readonly status: 'pending' | 'approved' | 'rejected';
}

export interface LeaveBalance {
  /** Earned in the `asOf` year, after the annual cap. */
  readonly accrued: number;
  /** Carried in from the previous year. */
  readonly carriedIn: number;
  /** Approved days taken in the `asOf` year. */
  readonly used: number;
  /** What the person can still take: carriedIn + accrued - used. */
  readonly balance: number;
}

/** Days since 1970-01-01 from an ISO date, by pure arithmetic (no Date, no timezone). */
function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  // Howard Hinnant's days-from-civil.
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Days a request takes: 0.5 for a half day, else every calendar day from start to end. */
export function leaveDays(u: Pick<LeaveUse, 'startDay' | 'endDay' | 'halfDay'>): number {
  if (u.halfDay) return 0.5;
  return dayNumber(u.endDay) - dayNumber(u.startDay) + 1;
}

const monthIndex = (iso: string): number => {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  return y * 12 + (m - 1);
};
const yearOf = (iso: string): number => Number(iso.slice(0, 4));
const hundredths = (n: number): number => Math.round(n * 100);

export function leaveBalance(input: {
  readonly rule: LeaveBalanceRule;
  /** The person's joining date (ISO). */
  readonly joinedOn: string;
  readonly asOf: string;
  readonly uses: readonly LeaveUse[];
}): LeaveBalance {
  const { rule, joinedOn, asOf } = input;
  const personFirst = monthIndex(joinedOn) + (Number(joinedOn.slice(8, 10)) > 15 ? 1 : 0);
  const first = Math.max(monthIndex(rule.startDay), personFirst);
  const last = monthIndex(asOf);
  const rate = hundredths(rule.accrualPerMonth);
  const aCap = rule.annualCap === null ? Infinity : hundredths(rule.annualCap);
  const cCap = rule.carryForwardCap === null ? Infinity : hundredths(rule.carryForwardCap);
  const firstYear = Math.floor(first / 12);
  const lastYear = Math.max(firstYear, yearOf(asOf));

  const usedIn = new Map<number, number>();
  for (const u of input.uses) {
    if (u.status !== 'approved' || monthIndex(u.startDay) > last) continue;
    const y = Math.max(firstYear, yearOf(u.startDay));
    usedIn.set(y, (usedIn.get(y) ?? 0) + hundredths(leaveDays(u)));
  }

  let carried = 0;
  let out: LeaveBalance = { accrued: 0, carriedIn: 0, used: 0, balance: 0 };
  for (let y = firstYear; y <= lastYear; y++) {
    const from = Math.max(first, y * 12);
    const to = Math.min(last, y * 12 + 11);
    const accrued = to >= from ? Math.min(aCap, rate * (to - from + 1)) : 0;
    const used = usedIn.get(y) ?? 0;
    const closing = carried + accrued - used;
    out = {
      accrued: accrued / 100,
      carriedIn: carried / 100,
      used: used / 100,
      balance: closing / 100,
    };
    carried = !rule.carryForward ? 0 : closing > 0 ? Math.min(closing, cCap) : closing;
  }
  return out;
}

export interface LeaveCheck {
  readonly days: number;
  /** The most the person could take in place of this request. */
  readonly available: number;
  /** False when approving would make the balance negative and the type does not allow overdraw. */
  readonly ok: boolean;
}

/**
 * The same check the server runs at approval (`waves_company_leave_check`), so the app can warn before submit.
 * The balance, WITH this request counted, must stay at or above zero from the request's month to the end of the
 * last year that holds approved leave of this type (so it cannot spend what later leave or a year-end reset took).
 * `available` is the worst month's balance plus this request's days.
 */
export function leaveCheck(input: {
  readonly rule: LeaveBalanceRule;
  readonly allowOverdraw: boolean;
  readonly joinedOn: string;
  /** The person's other requests of this type (the one being checked must not be in here). */
  readonly uses: readonly LeaveUse[];
  readonly request: Pick<LeaveUse, 'startDay' | 'endDay' | 'halfDay'>;
}): LeaveCheck {
  const { request } = input;
  const days = leaveDays(request);
  const mine: LeaveUse = { ...request, status: 'approved' };
  const lastYear = Math.max(
    yearOf(request.endDay),
    ...input.uses.filter((u) => u.status === 'approved').map((u) => yearOf(u.startDay)),
  );
  let worst = Infinity;
  for (let m = monthIndex(request.startDay); m <= lastYear * 12 + 11; m++) {
    const year = String(Math.floor(m / 12)).padStart(4, '0');
    const asOf = `${year}-${String((m % 12) + 1).padStart(2, '0')}-01`;
    const b = leaveBalance({
      rule: input.rule,
      joinedOn: input.joinedOn,
      asOf,
      uses: [...input.uses, mine],
    }).balance;
    worst = Math.min(worst, b);
  }
  return { days, available: worst + days, ok: input.allowOverdraw || worst >= 0 };
}
