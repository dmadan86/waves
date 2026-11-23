/**
 * Pure helpers for Investments and Rentals: free limits, region hints, how the
 * answers become records, and which reminders to hold. No clock, no storage.
 * Region only changes hint text and the deposit word, never a stored value.
 */

import {
  addPlanDays,
  monthKey,
  recentMonths,
  rentBalance,
  rentCardStatus,
  type RentBalance,
  type RentStatus,
  rentDues,
  stepOccurrence,
  type Cadence,
  type InvestmentType,
  type PersonalInvestment,
  type PersonalProperty,
  type PersonalRecurring,
  type PersonalTenancy,
  type PersonalTxn,
  type RentFrequency,
  pendingEscalation,
  raiseForOf,
  raisedRent,
} from '@waves/core';

export const FREE_INVESTMENTS = 3;
export const FREE_PROPERTIES = 1;
export const REMIND_HOUR = 10;

export type Region = 'IN' | 'US' | 'GB' | 'AU' | 'AE' | 'other';

export function regionOf(country: string | null | undefined): Region {
  const c = (country ?? '').toUpperCase();
  return c === 'IN' || c === 'US' || c === 'GB' || c === 'AU' || c === 'AE' ? c : 'other';
}

const HINTS: Partial<Record<InvestmentType, Partial<Record<Region, string>>>> = {
  fund: { IN: 'SIP', US: 'Auto-invest', GB: 'Regular investing', AU: 'Regular investing' },
  retirement: {
    IN: 'PPF, EPF, NPS',
    US: '401(k), IRA',
    GB: 'ISA, SIPP, workplace pension',
    AU: 'Super',
    AE: 'End-of-service savings',
  },
  deposit: { IN: 'FD, RD', US: 'CD', GB: 'Fixed-term deposit', AU: 'Term deposit' },
  metals: { IN: 'Gold, SGB' },
  savings_group: { IN: 'Chit fund' },
};

/** A region example for a type, or null. Hint text only. */
export function typeHint(type: InvestmentType, region: Region): string | null {
  if (type === 'savings_group') return HINTS.savings_group?.[region] ?? 'Savings circle (ROSCA)';
  return HINTS[type]?.[region] ?? null;
}

export type DepositTerm = 'depositAdvance' | 'depositBond' | 'depositSecurity' | 'depositHeld';

/** The word for the deposit: Advance (IN), Bond (AU), Security deposit (US/UK/AE). */
export function depositTerm(region: Region): DepositTerm {
  return region === 'IN'
    ? 'depositAdvance'
    : region === 'AU'
      ? 'depositBond'
      : region === 'US' || region === 'GB' || region === 'AE'
        ? 'depositSecurity'
        : 'depositHeld';
}

export function cadenceFor(freq: RentFrequency): { cadence: Cadence; interval: number } {
  switch (freq) {
    case 'weekly':
      return { cadence: 'weekly', interval: 1 };
    case 'fortnightly':
      return { cadence: 'weekly', interval: 2 };
    case 'quarterly':
      return { cadence: 'monthly', interval: 3 };
    case 'yearly':
      return { cadence: 'yearly', interval: 1 };
    default:
      return { cadence: 'monthly', interval: 1 };
  }
}

/** Reverse of `cadenceFor`, for showing a rule's rhythm. */
export function frequencyOfRule(
  rule: Pick<PersonalRecurring, 'cadence' | 'interval'>,
): RentFrequency {
  if (rule.cadence === 'weekly') return rule.interval === 2 ? 'fortnightly' : 'weekly';
  if (rule.cadence === 'yearly') return 'yearly';
  return rule.interval === 3 ? 'quarterly' : 'monthly';
}

export const investmentCategory = (type: InvestmentType): string => `inv.${type}`;

/** A due date in `month` ('YYYY-MM') on `day`, clamped to the month's length. */
export function dateInMonth(month: string, day: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

/** The first due date on or after `today` for a monthly-style schedule on `day`. */
export function firstDue(today: string, day: number): string {
  const here = dateInMonth(today.slice(0, 7), day);
  if (here >= today) return here;
  const [y, m] = today.slice(0, 7).split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return dateInMonth(next, day);
}

/**
 * The first rent due to track. An existing tenancy that began long ago starts
 * from this month, so years of history do not appear as overdue; one that has
 * not begun yet starts at its first due day after the start.
 */
export function rentAnchor(start: string, day: number, today: string, freq: RentFrequency): string {
  const early = start <= today;
  if (freq === 'weekly' || freq === 'fortnightly') return early ? today : start;
  return early ? dateInMonth(today.slice(0, 7), day) : firstDue(start, day);
}

export const atInvestmentLimit = (activeCount: number, isPro: boolean): boolean =>
  !isPro && activeCount >= FREE_INVESTMENTS;
export const atPropertyLimit = (activeCount: number, isPro: boolean): boolean =>
  !isPro && activeCount >= FREE_PROPERTIES;

/** A rent raise ends the old rule the day before the new one starts. */
export function endDayBefore(date: string): string {
  return addPlanDays(date, -1);
}

export function rentRaiseDates(
  rule: PersonalRecurring,
  effective: string,
): { due: string; oldEnd: string } {
  let due = rule.nextDate || rule.anchorDate;
  for (let i = 0; due < effective && i < 800; i += 1) {
    const next = stepOccurrence(rule, due);
    if (next <= due) break;
    due = next;
  }
  return { due, oldEnd: endDayBefore(due) };
}

export function rulesToCloseOnLeave(
  rules: readonly PersonalRecurring[],
  leave: string,
): PersonalRecurring[] {
  return rules.filter((r) => r.active && (r.endDate === null || r.endDate > leave));
}

/**
 * The rule collecting rent for a tenancy on `on`: start <= on and no end or
 * end >= on, newest start first. A tenancy that has not started yet falls back
 * to its earliest upcoming rule.
 */
export function currentRentRule(
  rules: readonly PersonalRecurring[],
  tenancyId: string,
  on: string,
): PersonalRecurring | null {
  const mine = rules.filter((r) => r.tenancyId === tenancyId && r.active);
  return (
    mine
      .filter((r) => r.anchorDate <= on && (r.endDate === null || r.endDate >= on))
      .sort((a, b) => (a.anchorDate < b.anchorDate ? 1 : -1))[0] ??
    nextRentRule(rules, tenancyId, on)
  );
}

/** The earliest rule that starts after `on`: a rent raise already booked. */
export function nextRentRule(
  rules: readonly PersonalRecurring[],
  tenancyId: string,
  on: string,
): PersonalRecurring | null {
  return (
    rules
      .filter((r) => r.tenancyId === tenancyId && r.active && r.anchorDate > on)
      .sort((a, b) => (a.anchorDate < b.anchorDate ? -1 : 1))[0] ?? null
  );
}

/** Same id for the same tenancy and start date, so a repeated raise upserts one rule. */
export function raiseRuleId(tenancyId: string | null, from: string): string | null {
  if (!tenancyId) return null;
  let h = 0x811c9dc5;
  for (const c of `${tenancyId}|${from}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return `${h.toString(16).padStart(8, '0')}${tenancyId.slice(8)}`;
}

/**
 * Drops raise rules whose predecessor was never ended (the second write of a
 * raise failed), so the raise reads as still pending and Apply can finish it.
 */
export function liveRules(rules: readonly PersonalRecurring[]): PersonalRecurring[] {
  return rules.filter(
    (r) =>
      raiseForOf(r) === null ||
      !rules.some(
        (o) =>
          o.id !== r.id &&
          o.tenancyId === r.tenancyId &&
          o.anchorDate < r.anchorDate &&
          (o.endDate === null || o.endDate >= r.anchorDate),
      ),
  );
}

export const rulesOfTenancy = (
  rules: readonly PersonalRecurring[],
  tenancyId: string,
): PersonalRecurring[] => rules.filter((r) => r.tenancyId === tenancyId);

export const paymentsOfTenancy = (
  txns: readonly PersonalTxn[],
  rules: readonly PersonalRecurring[],
): PersonalTxn[] => {
  const ids = new Set(rules.map((r) => r.id));
  return txns.filter(
    (t) => t.kind === 'income' && t.recurringId !== null && ids.has(t.recurringId),
  );
};

// ───────────────────────────────────────────────────────────── reminders ──

export interface WealthReminder {
  readonly id: string;
  readonly fireAt: number;
  readonly kind: 'sipTomorrow' | 'sipToday' | 'rentDue' | 'rentLate' | 'leaseEnd' | 'maturity';
  readonly name: string;
  readonly amount: bigint;
  readonly currency: string;
  readonly days: number;
  readonly url: string;
}

const at10 = (date: string): number => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, REMIND_HOUR, 0, 0, 0).getTime();
};

export const nextDueOnOrAfter = (rule: PersonalRecurring, today: string): string | null => {
  let d = rule.nextDate || rule.anchorDate;
  for (let i = 0; d < today && i < 800; i += 1) {
    const n = stepOccurrence(rule, d);
    if (n <= d) return null;
    d = n;
  }
  return rule.endDate !== null && d > rule.endDate ? null : d;
};

/** At most `limit` local reminders at 10:00, soonest first, all in the future. */
export function planWealthReminders(input: {
  investments: readonly PersonalInvestment[];
  properties: readonly PersonalProperty[];
  tenancies: readonly PersonalTenancy[];
  recurrings: readonly PersonalRecurring[];
  txns: readonly PersonalTxn[];
  today: string;
  now: number;
  limit?: number;
}): WealthReminder[] {
  const { investments, properties, tenancies, recurrings, txns, today, now } = input;
  const out: WealthReminder[] = [];
  const push = (r: WealthReminder): void => {
    if (r.fireAt > now) out.push(r);
  };

  for (const inv of investments) {
    if (inv.status !== 'active') continue;
    for (const rule of recurrings) {
      if (rule.investmentId !== inv.id || !rule.active) continue;
      const due = nextDueOnOrAfter(rule, today);
      if (!due) continue;
      push({
        id: `sip:${rule.id}:${due}`,
        fireAt: at10(rule.autoPost ? addPlanDays(due, -1) : due),
        kind: rule.autoPost ? 'sipTomorrow' : 'sipToday',
        name: inv.name,
        amount: rule.amount,
        currency: rule.currency,
        days: 0,
        url: `waves://investments/${inv.id}`,
      });
    }
    if (inv.maturityDate) {
      for (const n of [30, 7]) {
        push({
          id: `mat:${inv.id}:${n}`,
          fireAt: at10(addPlanDays(inv.maturityDate, -n)),
          kind: 'maturity',
          name: inv.name,
          amount: 0n,
          currency: inv.currency,
          days: n,
          url: `waves://investments/${inv.id}`,
        });
      }
    }
  }

  for (const tn of tenancies) {
    if (tn.status !== 'active') continue;
    const prop = properties.find((p) => p.id === tn.propertyId);
    const name = tn.unit ?? prop?.name ?? tn.tenantName;
    const rules = rulesOfTenancy(recurrings, tn.id);
    const url = `waves://rentals/${tn.propertyId}`;
    const bal = rentBalance(rentDues(rules, today), paymentsOfTenancy(txns, rules), today);
    // Dues already past and still unpaid: nudge 3 days after they fell due.
    for (const line of bal.lines) {
      if (line.status === 'paid') continue;
      const remaining = line.amount - line.paid;
      if (line.date >= today) {
        push({
          id: `rent:${tn.id}:${line.date}`,
          fireAt: at10(line.date),
          kind: 'rentDue',
          name,
          amount: remaining,
          currency: rules.find((r) => r.id === line.ruleId)?.currency ?? prop?.currency ?? 'USD',
          days: 0,
          url,
        });
      }
      push({
        id: `rentlate:${tn.id}:${line.date}`,
        fireAt: at10(addPlanDays(line.date, 3)),
        kind: 'rentLate',
        name,
        amount: remaining,
        currency: rules.find((r) => r.id === line.ruleId)?.currency ?? prop?.currency ?? 'USD',
        days: 3,
        url,
      });
    }
    const rule = currentRentRule(rules, tn.id, today);
    const due = rule ? nextDueOnOrAfter(rule, today) : null;
    if (rule && due && !bal.lines.some((l) => l.date === due)) {
      const remaining = rule.amount > bal.ahead ? rule.amount - bal.ahead : 0n;
      if (remaining > 0n)
        push({
          id: `rent:${tn.id}:${due}`,
          fireAt: at10(due),
          kind: 'rentDue',
          name,
          amount: remaining,
          currency: rule.currency,
          days: 0,
          url,
        });
      if (remaining > 0n)
        push({
          id: `rentlate:${tn.id}:${due}`,
          fireAt: at10(addPlanDays(due, 3)),
          kind: 'rentLate',
          name,
          amount: remaining,
          currency: rule.currency,
          days: 3,
          url,
        });
    }
    if (tn.endDate) {
      for (const n of [60, 30]) {
        push({
          id: `lease:${tn.id}:${n}`,
          fireAt: at10(addPlanDays(tn.endDate, -n)),
          kind: 'leaseEnd',
          name,
          amount: 0n,
          currency: prop?.currency ?? 'USD',
          days: n,
          url,
        });
      }
    }
  }

  return out.sort((a, b) => a.fireAt - b.fireAt).slice(0, input.limit ?? 40);
}

// ───────────────────────────────────────────────────────────── rentals ──

export interface PropertyView {
  readonly tenancy: PersonalTenancy | null;
  readonly rules: PersonalRecurring[];
  readonly rule: PersonalRecurring | null;
  /** A raise already booked for a later date. */
  readonly next: PersonalRecurring | null;
  readonly balance: RentBalance;
  readonly status: RentStatus | 'vacant';
}

export function propertyView(
  property: PersonalProperty,
  tenancies: readonly PersonalTenancy[],
  recurrings: readonly PersonalRecurring[],
  txns: readonly PersonalTxn[],
  today: string,
): PropertyView {
  const tenancy =
    tenancies.find((t) => t.propertyId === property.id && t.status === 'active') ?? null;
  const rules = tenancy ? rulesOfTenancy(recurrings, tenancy.id) : [];
  const balance = rentBalance(rentDues(rules, today), paymentsOfTenancy(txns, rules), today);
  return {
    tenancy,
    rules,
    rule: tenancy ? currentRentRule(recurrings, tenancy.id, today) : null,
    next: tenancy ? nextRentRule(recurrings, tenancy.id, today) : null,
    balance,
    status: tenancy ? rentCardStatus(balance, today) : 'vacant',
  };
}

/** What came in this month against what fell due this month, across all tenancies. */
export function monthRent(
  views: readonly PropertyView[],
  txns: readonly PersonalTxn[],
  month: string,
): { received: bigint; expected: bigint } {
  let received = 0n;
  let expected = 0n;
  const end = dateInMonth(month, 31);
  for (const v of views) {
    if (!v.tenancy) continue;
    for (const d of rentDues(v.rules, end)) if (monthKey(d.date) === month) expected += d.amount;
    for (const p of paymentsOfTenancy(txns, v.rules)) {
      if (monthKey(p.date) === month) received += p.amount;
    }
  }
  return { received, expected };
}

/** One state per month for the last 12 months, from the tenancy's running balance. */
export function rentStrip(
  balance: RentBalance,
  today: string,
): { month: string; state: RentStatus | 'none' }[] {
  return recentMonths(monthKey(today), 12).map((month) => {
    const lines = balance.lines.filter((l) => monthKey(l.date) === month);
    if (lines.length === 0) return { month, state: 'none' as const };
    const state: RentStatus = lines.every((l) => l.status === 'paid')
      ? 'paid'
      : lines.some((l) => l.status === 'overdue')
        ? 'overdue'
        : lines.some((l) => l.paid > 0n)
          ? 'part'
          : 'due';
    return { month, state };
  });
}

// ───────────────────────────────────────────────── yearly rent increase ──

export interface RaisePrompt {
  /** tenancy + anniversary: what "Not now" is remembered against. */
  readonly key: string;
  readonly tenancyId: string;
  readonly propertyId: string;
  readonly pct: number;
  readonly anniversary: string;
  /** The first rent day on or after the anniversary: where the new rule starts. */
  readonly from: string;
  readonly rule: PersonalRecurring;
  readonly oldAmount: bigint;
  readonly newAmount: bigint;
}

/** The yearly increase waiting on a tenancy, or null. Apply goes through `changeRent(rule, newAmount, from)`. */
export function raisePrompt(
  tn: PersonalTenancy,
  rules: readonly PersonalRecurring[],
  today: string,
): RaisePrompt | null {
  const mine = liveRules(rulesOfTenancy(rules, tn.id));
  const rule = currentRentRule(mine, tn.id, today);
  if (tn.status !== 'active' || !rule || !tn.escalationPct) return null;
  const anniversary = pendingEscalation({
    startDate: tn.startDate,
    endDate: tn.endDate,
    escalationPct: tn.escalationPct,
    raisedFor: mine.flatMap((r) => raiseForOf(r) ?? []),
    today,
  });
  if (!anniversary) return null;
  // Walk from the anchor (nextDate may already be past it) to keep the rent day.
  let from = rule.anchorDate;
  for (let i = 0; from < anniversary && i < 800; i += 1) {
    const n = stepOccurrence(rule, from);
    if (n <= from) break;
    from = n;
  }
  if (from < anniversary || (rule.endDate !== null && from > rule.endDate)) return null;
  return {
    key: `${tn.id}:${anniversary}`,
    tenancyId: tn.id,
    propertyId: tn.propertyId,
    pct: tn.escalationPct,
    anniversary,
    from,
    rule,
    oldAmount: rule.amount,
    newAmount: raisedRent(rule.amount, tn.escalationPct, rule.currency),
  };
}
