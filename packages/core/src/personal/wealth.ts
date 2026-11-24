/**
 * Pure maths for Investments and Rentals. No clock, no locale, no formatting.
 */

import type { CurrencyCode } from '../money/currency';
import { minorUnitScale } from '../money/currency';
import { dayDelta, monthKey, stepOccurrence } from './compute';
import { addPlanDays } from './plan';
import { isInvestmentCategory } from './sources';
import type { PersonalInvestment, PersonalRecurring, PersonalTxn } from './types';

/** Opening amount plus money put in, less money taken out. */
export function investedSoFar(inv: PersonalInvestment, txns: readonly PersonalTxn[]): bigint {
  let sum = inv.openingInvested;
  for (const t of txns) {
    if (t.investmentId !== inv.id || t.currency !== inv.currency) continue;
    if (!isInvestmentCategory(t.category)) continue;
    sum += t.kind === 'income' ? -t.amount : t.amount;
  }
  return sum;
}

/** What the active schedules put into the investment each month (weekly and
 *  fortnightly rules are scaled by 52/12, rounded down). */
export function goingInPerMonth(rules: readonly PersonalRecurring[], currency: string): bigint {
  let sum = 0n;
  for (const r of rules) {
    if (!r.active || !r.investmentId || r.currency !== currency || r.txnKind !== 'expense')
      continue;
    const n = BigInt(r.interval);
    if (r.cadence === 'weekly') sum += (r.amount * 52n) / (12n * n);
    else if (r.cadence === 'semimonthly') sum += r.amount * 2n;
    else if (r.cadence === 'monthly') sum += r.amount / n;
    else sum += r.amount / (12n * n);
  }
  return sum;
}

export interface RentDue {
  readonly date: string;
  readonly amount: bigint;
  readonly ruleId: string;
}

/**
 * Every rent due up to `today` across a tenancy's rules. A rent raise ends the
 * old rule and starts a new one on the same tenancy, because a rule prices every
 * period at its current amount; so the dues of all the rules are walked here,
 * each at its own amount.
 */
export function rentDues(rules: readonly PersonalRecurring[], today: string): RentDue[] {
  const out: RentDue[] = [];
  for (const rule of rules) {
    if (rule.anchorDate === '') continue;
    const last = rule.endDate !== null && rule.endDate < today ? rule.endDate : today;
    let cursor = rule.anchorDate;
    for (let guard = 0; cursor <= last && guard < 600; guard += 1) {
      out.push({ date: cursor, amount: rule.amount, ruleId: rule.id });
      const next = stepOccurrence(rule, cursor);
      if (next <= cursor) break;
      cursor = next;
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export type RentStatus = 'paid' | 'part' | 'overdue' | 'due';

export interface RentLine extends RentDue {
  readonly paid: bigint;
  readonly status: RentStatus;
}

export interface RentBalance {
  readonly lines: readonly RentLine[];
  readonly totalDue: bigint;
  readonly totalPaid: bigint;
  /** Still owed across all dues so far (never negative). */
  readonly balance: bigint;
  /** Paid beyond everything due so far. */
  readonly ahead: bigint;
}

/**
 * One running balance per tenancy: payments clear the oldest dues first.
 * Each payment is its own entry, so part payments simply add up.
 * `today` decides whether an unpaid line is still due or already overdue.
 */
export function rentBalance(
  dues: readonly RentDue[],
  payments: readonly Pick<PersonalTxn, 'amount'>[],
  today: string,
): RentBalance {
  let pool = payments.reduce((s, p) => s + p.amount, 0n);
  const totalPaid = pool;
  let totalDue = 0n;
  const lines: RentLine[] = dues.map((d) => {
    totalDue += d.amount;
    const paid = pool >= d.amount ? d.amount : pool;
    pool -= paid;
    // Unpaid once its day has passed is overdue; a part payment stays "part".
    const status: RentStatus =
      paid >= d.amount ? 'paid' : paid > 0n ? 'part' : d.date < today ? 'overdue' : 'due';
    return { ...d, paid, status };
  });
  const balance = totalDue > totalPaid ? totalDue - totalPaid : 0n;
  return { lines, totalDue, totalPaid, balance, ahead: pool };
}

/** The status a property card shows: worst of the current and older lines. */
export function rentCardStatus(b: RentBalance, today: string): RentStatus {
  if (
    b.lines.some(
      (l) => l.status === 'overdue' || (l.status === 'part' && monthKey(l.date) < monthKey(today)),
    )
  ) {
    return 'overdue';
  }
  if (b.lines.some((l) => l.status === 'part')) return 'part';
  if (b.lines.some((l) => l.status === 'due')) return 'due';
  return 'paid';
}

/** Days from `today` to a lease end when it is within `within` days, else null. */
export function leaseEndsIn(endDate: string | null, today: string, within = 60): number | null {
  if (!endDate) return null;
  const d = dayDelta(today, endDate);
  return d >= 0 && d <= within ? d : null;
}

/**
 * Settling the advance when a tenant leaves. Returned money is held money, not
 * income or spending: no txn. A kept or deducted part counts as income.
 */
export function settleDeposit(held: bigint, returned: bigint): { returned: bigint; kept: bigint } {
  const r = returned < 0n ? 0n : returned > held ? held : returned;
  return { returned: r, kept: held - r };
}

/**
 * Rent after a yearly increase of `pct` percent, in bigint minor units, rounded
 * to the nearest whole major unit (halves round up). `pct` may carry up to two
 * decimals. A bad or non-positive pct leaves the rent unchanged.
 */
export function raisedRent(amount: bigint, pct: number, currency: CurrencyCode): bigint {
  const bp = BigInt(Math.round(pct * 100));
  if (bp <= 0n) return amount;
  const raised = amount + (amount * bp) / 10_000n;
  const unit = minorUnitScale(currency);
  return ((raised + unit / 2n) / unit) * unit;
}

/** `start` plus `years`; 29 February in a common year becomes 28 February. */
export function addYears(start: string, years: number): string {
  const y = Number(start.slice(0, 4)) + years;
  const md = start.slice(5);
  if (md === '02-29' && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) return `${y}-02-28`;
  return `${String(y).padStart(4, '0')}-${md}`;
}

/**
 * The anniversary a yearly rent increase is waiting on: the latest one (start +
 * N years, N >= 1) that is within `within` days or already passed, unless a
 * rent rule created for that very anniversary exists (`raisedFor`), or the lease
 * ends before it. Null when nothing is due.
 */
export function pendingEscalation(input: {
  startDate: string;
  endDate: string | null;
  escalationPct: number | null;
  /** Anniversaries that rent rules created by a raise are for (`raiseForOf`). */
  raisedFor: readonly string[];
  today: string;
  within?: number;
}): string | null {
  const { startDate, endDate, escalationPct, today } = input;
  const within = input.within ?? 7;
  if (!escalationPct || escalationPct <= 0) return null;
  const horizon = addPlanDays(today, within);
  let latest: string | null = null;
  for (let n = 1; n < 100; n += 1) {
    const d = addYears(startDate, n);
    if (d > horizon) break;
    latest = d;
  }
  if (!latest || (endDate !== null && latest > endDate)) return null;
  return input.raisedFor.includes(latest) ? null : latest;
}

/** The anniversary a rent rule was created for by a yearly raise; null for any other rule. */
export function raiseForOf(rule: Pick<PersonalRecurring, 'carried'>): string | null {
  const v = rule.carried?.raiseFor;
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
