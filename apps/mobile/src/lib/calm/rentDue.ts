/** Rent still to come in, per active tenancy: shared by Today and the Rentals list. */

import type {
  PersonalProperty,
  PersonalRecurring,
  PersonalTenancy,
  PersonalTxn,
  RentLine,
} from '@waves/core';

import { fullPaymentOf, outstandingRent } from '@/lib/rentalScope';
import { daysBetween } from '@/lib/personalUpcoming';
import { nextDueOnOrAfter, propertyView } from '@/lib/wealthPlan';

export interface RentItem {
  readonly key: string;
  readonly tenancyId: string;
  readonly propertyId: string;
  readonly tenant: string;
  readonly unit: string;
  readonly rule: PersonalRecurring;
  readonly currency: string;
  /** What is still owed on that due. */
  readonly amount: bigint;
  readonly dueDate: string;
  /** Negative once overdue. */
  readonly inDays: number;
  readonly status: 'overdue' | 'today' | 'upcoming';
  /** The unpaid line, so a full payment keeps its fixed id (see recordRent). */
  readonly line: RentLine | undefined;
  readonly full: { date: string; ruleId: string } | null;
}

/** Days to look ahead so everything still unsettled this month is seen; at least a week. */
export function monthHorizon(today: string, min = 7): number {
  const last = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0));
  return Math.max(min, last.getUTCDate() - Number(today.slice(8, 10)));
}

/**
 * Every active tenancy with rent owing now (overdue or due today) or falling due
 * within `horizonDays`. Settled and vacant ones are not listed. Soonest first.
 */
export function rentItems(input: {
  properties: readonly PersonalProperty[];
  tenancies: readonly PersonalTenancy[];
  recurrings: readonly PersonalRecurring[];
  txns: readonly PersonalTxn[];
  today: string;
  horizonDays: number;
  fallbackCurrency: string;
}): RentItem[] {
  const out: RentItem[] = [];
  const limit = new Date(Date.parse(`${input.today}T00:00:00Z`) + input.horizonDays * 864e5)
    .toISOString()
    .slice(0, 10);
  for (const p of input.properties) {
    if (p.status !== 'active') continue;
    const v = propertyView(p, input.tenancies, input.recurrings, input.txns, input.today);
    const tn = v.tenancy;
    if (!tn || !v.rule) continue;
    const base = {
      tenancyId: tn.id,
      propertyId: p.id,
      tenant: tn.tenantName,
      unit: tn.unit ?? p.name,
      rule: v.rule,
      currency: v.rule.currency || p.currency || input.fallbackCurrency,
    };
    const line = v.balance.lines.find((l) => l.status !== 'paid' && l.date <= input.today);
    if (line) {
      const amount = outstandingRent(line);
      out.push({
        ...base,
        key: `rent:${tn.id}:${line.date}`,
        amount,
        dueDate: line.date,
        inDays: daysBetween(input.today, line.date),
        status: line.date < input.today ? 'overdue' : 'today',
        line,
        full: fullPaymentOf(line, amount),
      });
      continue;
    }
    const due = nextDueOnOrAfter(v.rule, input.today);
    // A paid due-today line means that occurrence is settled; `nextDate` may still point at it.
    if (due && due <= limit && !v.balance.lines.some((l) => l.date === due)) {
      out.push({
        ...base,
        key: `rent:${tn.id}:${due}`,
        amount: v.rule.amount,
        dueDate: due,
        inDays: daysBetween(input.today, due),
        status: due === input.today ? 'today' : 'upcoming',
        line: undefined,
        full: null,
      });
    }
  }
  return out.sort((a, b) => a.inDays - b.inDays || (a.key < b.key ? -1 : 1));
}
