/**
 * Working capital and company-wide spending caps. Both live in the company's policy
 * rules (`capital` records and `company_cap` rules), so they ride the policy sync.
 *
 * "Spending" is cash that left the company, counted once: approved or reimbursed
 * expenses, bata, advances and wages (company-paid ones too), the pay of a wage run
 * beyond the claims it folded in (those are already expenses), and approved vendor
 * payments and advances. Not spending: submitted/rejected/voided entries, vendor
 * bills (paid when paid), reimbursements (they settle expenses already counted)
 * and manager float movements (the spend itself is the expense).
 */

import type { CompanyEntry, CompanyPolicies } from './index';
import type { VendorLine } from './vendors';

export type CapPeriod = 'days' | 'week' | 'month' | 'year';

export interface SpendItem {
  readonly id: string;
  /** yyyy-mm-dd */
  readonly day: string;
  readonly amount: bigint;
}

export function companySpendItems(
  entries: readonly CompanyEntry[],
  vendorLines: readonly VendorLine[] = [],
): SpendItem[] {
  const items: SpendItem[] = [];
  for (const e of entries) {
    if (e.deleted || (e.status !== 'approved' && e.status !== 'reimbursed')) continue;
    let amount = 0n;
    if (
      e.kind === 'expense' ||
      e.kind === 'allowance' ||
      e.kind === 'advance' ||
      e.kind === 'wages'
    )
      amount = e.amount;
    else if (e.kind === 'wage_payment') {
      const rest = e.amount - (e.claimsMinor ?? 0n);
      amount = rest > 0n ? rest : 0n;
    }
    if (amount > 0n) items.push({ id: e.id, day: e.occurredOn, amount });
  }
  for (const l of vendorLines)
    if (!l.deleted && l.status === 'approved' && l.kind !== 'bill')
      items.push({ id: l.id, day: l.occurredOn, amount: l.amount });
  return items;
}

const DAY = 86_400_000;
const toMs = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
const toIso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * The period a cap measures for a given day: `days` is a rolling window of n days ending
 * on that day; week starts Monday; month and year are calendar. Both ends inclusive.
 */
export function capWindow(
  period: CapPeriod,
  days: number,
  on: string,
): { readonly from: string; readonly to: string } {
  const ms = toMs(on);
  if (period === 'days') return { from: toIso(ms - (Math.max(1, days) - 1) * DAY), to: on };
  if (period === 'week') {
    const back = (new Date(ms).getUTCDay() + 6) % 7;
    return { from: toIso(ms - back * DAY), to: toIso(ms - back * DAY + 6 * DAY) };
  }
  if (period === 'month') {
    const last = new Date(Date.UTC(+on.slice(0, 4), +on.slice(5, 7), 0)).getUTCDate();
    return {
      from: `${on.slice(0, 7)}-01`,
      to: `${on.slice(0, 7)}-${String(last).padStart(2, '0')}`,
    };
  }
  return { from: `${on.slice(0, 4)}-01-01`, to: `${on.slice(0, 4)}-12-31` };
}

export function spentIn(
  items: readonly SpendItem[],
  window: { readonly from: string; readonly to: string },
  start = 0n,
): bigint {
  let total = start;
  for (const i of items) if (i.day >= window.from && i.day <= window.to) total += i.amount;
  return total;
}

export interface CapUsage {
  readonly ruleId: string;
  readonly period: CapPeriod;
  readonly days: number;
  readonly limit: bigint;
  readonly used: bigint;
  readonly over: boolean;
}

/** Each cap's usage in the period that holds `today`. */
export function capUsages(
  policies: CompanyPolicies,
  spend: readonly SpendItem[],
  today: string,
): CapUsage[] {
  const out: CapUsage[] = [];
  for (const r of policies.rules) {
    if (r.type !== 'company_cap') continue;
    const days = r.days ?? 1;
    const limit = BigInt(r.limitMinor);
    const used = spentIn(spend, capWindow(r.period, days, today));
    out.push({ ruleId: r.id, period: r.period, days, limit, used, over: used > limit });
  }
  return out;
}

export interface WorkingCapital {
  /** Top-ups less take-outs. */
  readonly capital: bigint;
  /** Spending since the day the first record was made. */
  readonly spent: bigint;
  readonly left: bigint;
  readonly set: boolean;
}

export function workingCapital(
  policies: CompanyPolicies,
  spend: readonly SpendItem[],
): WorkingCapital {
  let capital = 0n;
  let since: string | null = null;
  for (const r of policies.rules) {
    if (r.type !== 'capital') continue;
    capital += r.direction === 'out' ? -BigInt(r.limitMinor) : BigInt(r.limitMinor);
    const day = r.at.slice(0, 10);
    if (since === null || day < since) since = day;
  }
  if (since === null) return { capital, spent: 0n, left: 0n, set: false };
  const spent = spentIn(spend, { from: since, to: '9999-12-31' });
  return { capital, spent, left: capital - spent, set: true };
}
