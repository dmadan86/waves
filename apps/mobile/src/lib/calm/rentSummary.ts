/** The calm Rentals list: what is due now, who has paid, and a lease about to end. */

import { leaseEndsIn, type PersonalTenancy } from '@waves/core';

export interface DueLike {
  readonly tenancyId: string;
  readonly amount: bigint;
  readonly currency: string;
  readonly inDays: number;
}

/** Everyone still to pay: the total in one currency and the headcount. */
export function dueNow(
  items: readonly DueLike[],
  currency: string,
): { total: bigint; count: number } {
  return {
    total: items.filter((i) => i.currency === currency).reduce((s, i) => s + i.amount, 0n),
    count: items.length,
  };
}

/** Tenants with nothing owing now: everyone active who is not in the due list. */
export function paidTenancies<T extends { id: string }>(
  tenancies: readonly T[],
  due: readonly { tenancyId: string }[],
): T[] {
  const owing = new Set(due.map((d) => d.tenancyId));
  return tenancies.filter((t) => !owing.has(t.id));
}

/** "A, B and C"; past `max` names, the first (max - 1) and "N more". */
export function nameList(
  names: readonly string[],
  join: (parts: string[]) => string,
  more: (n: number) => string,
  max = 3,
): string {
  if (names.length <= max) return join([...names]);
  return join([...names.slice(0, max - 1), more(names.length - (max - 1))]);
}

/** The soonest lease end inside `within` days (default 90), with its tenant. */
export function leaseNudge(
  tenancies: readonly PersonalTenancy[],
  today: string,
  within = 90,
): { tenancy: PersonalTenancy; days: number } | null {
  let best: { tenancy: PersonalTenancy; days: number } | null = null;
  for (const tenancy of tenancies) {
    if (tenancy.status !== 'active') continue;
    const days = leaseEndsIn(tenancy.endDate, today, within);
    if (days !== null && (!best || days < best.days)) best = { tenancy, days };
  }
  return best;
}
